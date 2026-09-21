import assert from "node:assert/strict";
import test from "node:test";

import { GameRuleError } from "../src/shared/games/errors.js";
import {
  MATCH_LIMIT,
  addPlayer,
  applyAction,
  calculateRoundScores,
  captureOptions,
  cardValue,
  createGame,
  makeDeck,
  primieraScore,
  viewForPlayer,
} from "../src/shared/games/scopa.js";

function card(rank, suit = "♠", id = `${rank}${suit}`) {
  return { rank, suit, id };
}

function deterministicTools() {
  let nextId = 0;
  return {
    idFactory: () => `scopa-${nextId++}`,
    randomInt: () => 0,
  };
}

function startedGame() {
  const tools = deterministicTools();
  const game = createGame({ roomCode: "SCO123", host: { id: "p1", name: "Ari" } });
  addPlayer(game, { id: "p2", name: "Bo" }, tools);
  return { game, tools };
}

test("Scopa uses the forty-card deck and Italian capture values", () => {
  let nextId = 0;
  const deck = makeDeck(() => `card-${nextId++}`);

  assert.equal(deck.length, 40);
  assert.ok(!deck.some((candidate) => ["8", "9", "10"].includes(candidate.rank)));
  assert.equal(cardValue(card("A")), 1);
  assert.equal(cardValue(card("7")), 7);
  assert.equal(cardValue(card("J")), 8);
  assert.equal(cardValue(card("Q")), 9);
  assert.equal(cardValue(card("K")), 10);
});

test("Scopa deals three cards each, four to the table, and hides only the opponent hand", () => {
  const { game } = startedGame();
  const view = viewForPlayer(game, "p1");
  const own = view.players.find((player) => player.id === "p1").hand;
  const opponent = view.players.find((player) => player.id === "p2").hand;

  assert.equal(game.deck.length, 30);
  assert.equal(view.table.length, 4);
  assert.equal(own.length, 3);
  assert.ok(own.every((candidate) => !candidate.hidden && candidate.rank));
  assert.ok(opponent.every((candidate) => candidate.hidden && !Object.hasOwn(candidate, "rank")));
});

test("a matching table card takes precedence over equal-sum combinations", () => {
  const table = [
    card("5", "♥", "five"),
    card("A", "♠", "ace"),
    card("4", "♣", "four"),
    card("2", "♦", "two"),
    card("3", "♣", "three"),
  ];

  assert.deepEqual(captureOptions(table, card("5", "♦")), [["five"]]);
  assert.deepEqual(
    captureOptions(table.filter((candidate) => candidate.id !== "five"), card("5", "♦")),
    [["ace", "four"], ["two", "three"]],
  );
});

test("capturing the whole table scores a scopa and passes the turn", () => {
  const { game, tools } = startedGame();
  const playerId = game.currentPlayerId;
  const opponentId = game.players.find((player) => player.id !== playerId).id;
  game.hands[playerId] = [card("6", "♣", "played")];
  game.hands[opponentId] = [card("K", "♥", "waiting")];
  game.table = [card("A", "♠", "ace"), card("5", "♦", "five")];

  applyAction(game, playerId, { type: "PLAY_CARD", handIndex: 0, captureIds: ["ace", "five"] }, tools);

  assert.equal(game.table.length, 0);
  assert.deepEqual(game.captures[playerId].map((candidate) => candidate.id), ["ace", "five", "played"]);
  assert.equal(game.scopas[playerId], 1);
  assert.equal(game.currentPlayerId, opponentId);
});

test("a card with no capture stays face up on the table", () => {
  const { game, tools } = startedGame();
  const playerId = game.currentPlayerId;
  game.hands[playerId] = [card("7", "♣", "played")];
  game.table = [card("K", "♦", "king")];

  applyAction(game, playerId, { type: "PLAY_CARD", handIndex: 0, captureIds: [] }, tools);

  assert.deepEqual(game.table.map((candidate) => candidate.id), ["king", "played"]);
  assert.equal(game.captures[playerId].length, 0);
});

test("the engine rejects a sum capture when a matching single exists", () => {
  const { game, tools } = startedGame();
  const playerId = game.currentPlayerId;
  game.hands[playerId] = [card("5", "♣", "played")];
  game.table = [card("5", "♥", "match"), card("A", "♠", "ace"), card("4", "♦", "four")];

  assert.throws(
    () => applyAction(game, playerId, { type: "PLAY_CARD", handIndex: 0, captureIds: ["ace", "four"] }, tools),
    (error) => error instanceof GameRuleError,
  );
});

test("empty hands receive another three-card deal until the stock is gone", () => {
  const { game, tools } = startedGame();
  const playerId = game.currentPlayerId;
  const opponentId = game.players.find((player) => player.id !== playerId).id;
  game.hands[playerId] = [card("7", "♣", "played")];
  game.hands[opponentId] = [];
  game.table = [card("K", "♦", "king")];
  game.deck = [
    card("A", "♠", "d1"), card("2", "♠", "d2"), card("3", "♠", "d3"),
    card("4", "♠", "d4"), card("5", "♠", "d5"), card("6", "♠", "d6"),
  ];

  applyAction(game, playerId, { type: "PLAY_CARD", handIndex: 0, captureIds: [] }, tools);

  assert.equal(game.batchNumber, 2);
  assert.equal(game.deck.length, 0);
  assert.equal(game.hands[playerId].length, 3);
  assert.equal(game.hands[opponentId].length, 3);
});

test("the final play never scores a scopa and remaining cards go to the last capturer", () => {
  const { game, tools } = startedGame();
  const playerId = game.currentPlayerId;
  const opponentId = game.players.find((player) => player.id !== playerId).id;
  game.deck = [];
  game.hands[playerId] = [card("6", "♣", "played")];
  game.hands[opponentId] = [];
  game.table = [card("A", "♠", "ace"), card("5", "♦", "five")];
  game.lastCapturerId = opponentId;

  applyAction(game, playerId, { type: "PLAY_CARD", handIndex: 0, captureIds: ["ace", "five"] }, tools);

  assert.equal(game.status, "round-finished");
  assert.equal(game.scopas[playerId], 0);
  assert.equal(game.captures[playerId].length, 3);
  assert.equal(game.table.length, 0);
});

test("round scoring awards cards, diamonds, settebello, primiera, and every scopa", () => {
  const players = [{ id: "p1" }, { id: "p2" }];
  const p1 = [
    card("7", "♦", "7d"), card("6", "♠", "6s"), card("A", "♥", "ah"), card("5", "♣", "5c"),
    card("6", "♦", "6d"), card("5", "♦", "5d"), card("4", "♦", "4d"), card("3", "♦", "3d"),
  ];
  const p2 = [card("7", "♠", "7s"), card("7", "♥", "7h"), card("7", "♣", "7c")];
  const { points, breakdown } = calculateRoundScores(players, { p1, p2 }, { p1: 2, p2: 0 });

  assert.equal(primieraScore(p1), 70);
  assert.equal(primieraScore(p2), null);
  assert.deepEqual(points, { p1: 6, p2: 0 });
  assert.deepEqual(breakdown.awards, {
    cards: "p1",
    diamonds: "p1",
    settebello: "p1",
    primiera: "p1",
  });
});

test("a unique leader at eleven points wins the match", () => {
  const { game, tools } = startedGame();
  const playerId = game.currentPlayerId;
  const opponentId = game.players.find((player) => player.id !== playerId).id;
  game.scores[playerId] = MATCH_LIMIT - 1;
  game.deck = [];
  game.hands[playerId] = [card("7", "♦", "played")];
  game.hands[opponentId] = [];
  game.table = [card("7", "♠", "match")];
  game.captures[playerId] = [card("7", "♥", "h"), card("7", "♣", "c")];
  game.captures[opponentId] = [];

  applyAction(game, playerId, { type: "PLAY_CARD", handIndex: 0, captureIds: ["match"] }, tools);

  assert.equal(game.status, "match-finished");
  assert.deepEqual(game.matchWinnerIds, [playerId]);
  assert.ok(game.scores[playerId] >= MATCH_LIMIT);
});
