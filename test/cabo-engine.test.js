import assert from "node:assert/strict";
import test from "node:test";

import {
  GameRuleError,
  addPlayer,
  applyAction,
  createGame,
  scoreCard,
  viewForPlayer,
} from "../src/shared/games/cabo.js";

function deterministicTools() {
  let nextId = 0;
  return {
    idFactory: () => `opaque-${nextId++}`,
    randomInt: () => 0,
  };
}

function startedGame() {
  const tools = deterministicTools();
  const game = createGame({ roomCode: "ABC123", host: { id: "p1", name: "Ari" } });
  addPlayer(game, { id: "p2", name: "Bo" }, tools);
  return { game, tools };
}

function readyGame() {
  const { game, tools } = startedGame();
  applyAction(game, "p1", { type: "READY" }, tools);
  applyAction(game, "p2", { type: "READY" }, tools);
  return { game, tools };
}

test("opening views reveal only each player's bottom two cards", () => {
  const { game } = startedGame();
  const p1 = viewForPlayer(game, "p1");
  const own = p1.players.find((player) => player.id === "p1").hand;
  const opponent = p1.players.find((player) => player.id === "p2").hand;

  assert.deepEqual(own.map((card) => card.hidden), [true, true, false, false]);
  assert.ok(opponent.every((card) => card.hidden));
  assert.equal(JSON.stringify(opponent).includes("rank"), false);
});

test("both players must finish the opening peek before play", () => {
  const { game, tools } = startedGame();
  applyAction(game, "p1", { type: "READY" }, tools);
  assert.equal(game.status, "peeking");
  assert.deepEqual(viewForPlayer(game, "p1").legalActions, []);

  applyAction(game, "p2", { type: "READY" }, tools);
  assert.equal(game.status, "playing");
  assert.equal(game.phase, "await-draw");
  assert.equal(game.currentPlayerId, "p1");
});

test("the server rejects out-of-turn actions", () => {
  const { game, tools } = readyGame();
  assert.throws(
    () => applyAction(game, "p2", { type: "DRAW_DECK" }, tools),
    (error) => error instanceof GameRuleError && error.code === "not_your_turn",
  );
});

test("a deck draw is visible only to the drawing player", () => {
  const { game, tools } = readyGame();
  applyAction(game, "p1", { type: "DRAW_DECK" }, tools);

  assert.equal(viewForPlayer(game, "p1").drawn.hidden, false);
  const opponentDrawn = viewForPlayer(game, "p2").drawn;
  assert.equal(opponentDrawn.hidden, true);
  assert.equal(Object.hasOwn(opponentDrawn, "rank"), false);
});

test("replacing a card ends the turn and publicly reveals the discard", () => {
  const { game, tools } = readyGame();
  applyAction(game, "p1", { type: "DRAW_DECK" }, tools);
  const discarded = game.hands.p1[0];
  applyAction(game, "p1", { type: "REPLACE", index: 0 }, tools);

  assert.equal(game.currentPlayerId, "p2");
  assert.equal(game.phase, "await-draw");
  assert.equal(game.discard.at(-1).id, discarded.id);
  assert.equal(viewForPlayer(game, "p2").discard.at(-1).rank, discarded.rank);
});

test("peek powers reveal exactly one private opponent card", () => {
  const { game, tools } = readyGame();
  game.drawn = { id: "power-card", rank: "9", suit: "♠" };
  game.drawnSource = "deck";
  game.phase = "drawn";

  applyAction(game, "p1", { type: "DISCARD_DRAWN" }, tools);
  applyAction(game, "p1", { type: "SELECT_OPPONENT", index: 1 }, tools);

  const p1Opponent = viewForPlayer(game, "p1").players.find((player) => player.id === "p2").hand;
  const p2Own = viewForPlayer(game, "p2").players.find((player) => player.id === "p2").hand;
  assert.deepEqual(p1Opponent.map((card) => card.hidden), [true, false, true, true]);
  assert.ok(p2Own.every((card) => card.hidden));

  applyAction(game, "p1", { type: "CONFIRM_PEEK" }, tools);
  assert.equal(game.currentPlayerId, "p2");
  assert.ok(viewForPlayer(game, "p1").players.find((player) => player.id === "p2").hand.every((card) => card.hidden));
});

test("Cabo gives the opponent one final completed turn", () => {
  const { game, tools } = readyGame();
  applyAction(game, "p1", { type: "CALL_CABO" }, tools);
  assert.equal(game.currentPlayerId, "p2");
  assert.equal(game.status, "playing");

  applyAction(game, "p2", { type: "DRAW_DECK" }, tools);
  applyAction(game, "p2", { type: "REPLACE", index: 0 }, tools);

  assert.equal(game.status, "finished");
  assert.equal(game.phase, "game-over");
  assert.equal(Object.keys(game.scores).length, 2);
  assert.ok(viewForPlayer(game, "p1").players.every((player) => player.hand.every((card) => !card.hidden)));
});

test("a rematch waits for both players and alternates the starter", () => {
  const { game, tools } = readyGame();
  const firstStarter = game.startingPlayerId;
  applyAction(game, "p1", { type: "CALL_CABO" }, tools);
  applyAction(game, "p2", { type: "DRAW_DECK" }, tools);
  applyAction(game, "p2", { type: "REPLACE", index: 0 }, tools);

  applyAction(game, "p1", { type: "REMATCH" }, tools);
  assert.equal(game.status, "finished");
  applyAction(game, "p2", { type: "REMATCH" }, tools);

  assert.equal(game.status, "peeking");
  assert.equal(game.roundNumber, 2);
  assert.notEqual(game.startingPlayerId, firstStarter);
});

test("a Jack performs a blind swap and ends the turn", () => {
  const { game, tools } = readyGame();
  const own = game.hands.p1[0];
  const theirs = game.hands.p2[1];
  game.drawn = { id: "jack", rank: "J", suit: "♣" };
  game.drawnSource = "deck";
  game.phase = "drawn";

  applyAction(game, "p1", { type: "DISCARD_DRAWN" }, tools);
  applyAction(game, "p1", { type: "SELECT_OWN", index: 0 }, tools);
  applyAction(game, "p1", { type: "SELECT_OPPONENT", index: 1 }, tools);

  assert.equal(game.hands.p1[0].id, theirs.id);
  assert.equal(game.hands.p2[1].id, own.id);
  assert.equal(game.currentPlayerId, "p2");
});

test("a Queen swaps and privately reveals the received card until confirmed", () => {
  const { game, tools } = readyGame();
  const received = game.hands.p2[2];
  game.drawn = { id: "queen", rank: "Q", suit: "♦" };
  game.drawnSource = "deck";
  game.phase = "drawn";

  applyAction(game, "p1", { type: "DISCARD_DRAWN" }, tools);
  applyAction(game, "p1", { type: "SELECT_OWN", index: 0 }, tools);
  applyAction(game, "p1", { type: "SELECT_OPPONENT", index: 2 }, tools);

  assert.equal(game.phase, "power-confirm");
  const ownView = viewForPlayer(game, "p1").players.find((player) => player.id === "p1").hand;
  assert.equal(ownView[0].id, received.id);
  assert.equal(ownView[0].hidden, false);
  assert.ok(viewForPlayer(game, "p2").players.find((player) => player.id === "p1").hand.every((card) => card.hidden));
});

test("a King can inspect and then keep or swap", () => {
  const { game, tools } = readyGame();
  const own = game.hands.p1[0];
  const theirs = game.hands.p2[3];
  game.drawn = { id: "king", rank: "K", suit: "♠" };
  game.drawnSource = "deck";
  game.phase = "drawn";

  applyAction(game, "p1", { type: "DISCARD_DRAWN" }, tools);
  applyAction(game, "p1", { type: "SELECT_OPPONENT", index: 3 }, tools);
  assert.equal(viewForPlayer(game, "p1").players.find((player) => player.id === "p2").hand[3].hidden, false);
  applyAction(game, "p1", { type: "SELECT_OWN", index: 0 }, tools);
  applyAction(game, "p1", { type: "KING_SWAP" }, tools);

  assert.equal(game.hands.p1[0].id, theirs.id);
  assert.equal(game.hands.p2[3].id, own.id);
  assert.equal(game.currentPlayerId, "p2");
});

test("matching empties a spot without moving the rest of the hand", () => {
  const { game, tools } = readyGame();
  const matchingCard = game.hands.p1[1];
  const others = [game.hands.p1[0], game.hands.p1[2], game.hands.p1[3]].map((card) => card.id);
  game.discard = [{ id: "matching-top", rank: matchingCard.rank, suit: "♠" }];
  applyAction(game, "p1", { type: "MATCH_START" }, tools);
  applyAction(game, "p1", { type: "MATCH", index: 1 }, tools);

  assert.equal(game.hands.p1.length, 4);
  assert.equal(game.hands.p1[1], null);
  assert.deepEqual([game.hands.p1[0], game.hands.p1[2], game.hands.p1[3]].map((card) => card.id), others);
  assert.equal(game.phase, "await-draw");

  const hand = viewForPlayer(game, "p1").players.find((player) => player.id === "p1").hand;
  assert.equal(hand.length, 4);
  assert.equal(hand[1], null);
});

test("an emptied spot cannot be played and is not scored", () => {
  const { game, tools } = readyGame();
  const matchingCard = game.hands.p1[0];
  game.discard = [{ id: "matching-top", rank: matchingCard.rank, suit: "♠" }];
  applyAction(game, "p1", { type: "MATCH_START" }, tools);
  applyAction(game, "p1", { type: "MATCH", index: 0 }, tools);

  applyAction(game, "p1", { type: "DRAW_DECK" }, tools);
  assert.throws(
    () => applyAction(game, "p1", { type: "REPLACE", index: 0 }, tools),
    (error) => error instanceof GameRuleError,
  );

  applyAction(game, "p1", { type: "REPLACE", index: 1 }, tools);
  applyAction(game, "p2", { type: "CALL_CABO" }, tools);
  applyAction(game, "p1", { type: "DRAW_DECK" }, tools);
  applyAction(game, "p1", { type: "REPLACE", index: 1 }, tools);

  assert.equal(game.status, "finished");
  const expected = game.hands.p1.reduce((total, card) => total + (card ? scoreCard(card) : 0), 0);
  assert.equal(game.scores.p1, expected);
});

test("a penalty card fills an empty spot before the hand grows", () => {
  const { game, tools } = readyGame();
  const matchingCard = game.hands.p1[2];
  game.discard = [{ id: "matching-top", rank: matchingCard.rank, suit: "♠" }];
  applyAction(game, "p1", { type: "MATCH_START" }, tools);
  applyAction(game, "p1", { type: "MATCH", index: 2 }, tools);

  const kept = [game.hands.p1[0], game.hands.p1[1], game.hands.p1[3]].map((card) => card.id);
  const wrongRank = game.hands.p1[0].rank === "A" ? "2" : "A";
  game.discard = [{ id: "different-top", rank: wrongRank, suit: "♥" }];
  applyAction(game, "p1", { type: "MATCH_START" }, tools);
  applyAction(game, "p1", { type: "MATCH", index: 0 }, tools);

  assert.equal(game.hands.p1.length, 4);
  assert.ok(game.hands.p1[2]);
  assert.deepEqual([game.hands.p1[0], game.hands.p1[1], game.hands.p1[3]].map((card) => card.id), kept);
});

test("a wrong match with no empty spot grows the hand", () => {
  const { game, tools } = readyGame();
  const wrongRank = game.hands.p1[0].rank === "A" ? "2" : "A";
  game.discard = [{ id: "different-top", rank: wrongRank, suit: "♥" }];
  applyAction(game, "p1", { type: "MATCH_START" }, tools);
  applyAction(game, "p1", { type: "MATCH", index: 0 }, tools);
  assert.equal(game.hands.p1.length, 5);
  assert.equal(game.currentPlayerId, "p1");
});

test("power cards can be skipped without leaving stale private state", () => {
  const { game, tools } = readyGame();
  game.drawn = { id: "ten", rank: "10", suit: "♥" };
  game.drawnSource = "deck";
  game.phase = "drawn";
  applyAction(game, "p1", { type: "DISCARD_DRAWN" }, tools);
  applyAction(game, "p1", { type: "SKIP_POWER" }, tools);

  assert.equal(game.currentPlayerId, "p2");
  assert.equal(game.reveal, null);
  assert.equal(game.selectedOwn, null);
  assert.equal(game.selectedOpponent, null);
});
