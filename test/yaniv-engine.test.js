import assert from "node:assert/strict";
import test from "node:test";

import { GameRuleError } from "../src/shared/games/errors.js";
import {
  ASSAF_PENALTY,
  MATCH_LIMIT,
  addPlayer,
  applyAction,
  createGame,
  handValue,
  isValidMeld,
  scoreCard,
  viewForPlayer,
} from "../src/shared/games/yaniv.js";
import { supportedGameTypes } from "../src/shared/games/registry.js";

function card(rank, suit = "♠", id = `${rank}${suit}`) {
  return { rank, suit: rank === "JOKER" ? "" : suit, id };
}

function deterministicTools() {
  let nextId = 0;
  return {
    idFactory: () => `yaniv-${nextId++}`,
    randomInt: () => 0,
  };
}

function startedGame() {
  const tools = deterministicTools();
  const game = createGame({ roomCode: "YAN123", host: { id: "p1", name: "Ari" } });
  addPlayer(game, { id: "p2", name: "Bo" }, tools);
  return { game, tools };
}

test("the game registry exposes every online card game", () => {
  assert.deepEqual(supportedGameTypes(), ["cabo", "yaniv", "scopa"]);
});

test("Yaniv deals five cards and redacts only the opponent hand", () => {
  const { game } = startedGame();
  const view = viewForPlayer(game, "p1");
  const own = view.players.find((player) => player.id === "p1").hand;
  const opponent = view.players.find((player) => player.id === "p2").hand;

  assert.equal(game.gameType, "yaniv");
  assert.equal(own.length, 5);
  assert.ok(own.every((candidate) => !candidate.hidden && candidate.rank));
  assert.ok(opponent.every((candidate) => candidate.hidden && !Object.hasOwn(candidate, "rank")));
});

test("Yaniv scoring uses ace low, faces ten, and jokers zero", () => {
  assert.equal(scoreCard(card("A")), 1);
  assert.equal(scoreCard(card("Q")), 10);
  assert.equal(scoreCard(card("JOKER")), 0);
  assert.equal(handValue([card("A"), card("5"), card("K"), card("JOKER")]), 16);
});

test("valid melds include singles, same-rank sets, suited runs, and joker-assisted runs", () => {
  assert.equal(isValidMeld([card("K")]), true);
  assert.equal(isValidMeld([card("7", "♠"), card("7", "♥")]), true);
  assert.equal(isValidMeld([card("3", "♦"), card("4", "♦"), card("5", "♦")]), true);
  assert.equal(isValidMeld([card("3", "♦"), card("JOKER"), card("5", "♦")]), true);
  assert.equal(isValidMeld([card("3", "♦"), card("4", "♣"), card("5", "♦")]), false);
  assert.equal(isValidMeld([card("3", "♦"), card("5", "♦"), card("7", "♦")]), false);
});

test("a turn plays a valid meld and then draws exactly one card", () => {
  const { game, tools } = startedGame();
  const playerId = game.currentPlayerId;
  const opponentId = game.players.find((player) => player.id !== playerId).id;
  game.hands[playerId] = [card("7", "♠", "a"), card("7", "♥", "b"), card("K", "♣", "c")];

  applyAction(game, playerId, { type: "TOGGLE_CARD", index: 0 }, tools);
  applyAction(game, playerId, { type: "TOGGLE_CARD", index: 1 }, tools);
  assert.ok(viewForPlayer(game, playerId).legalActions.includes("PLAY_SELECTED"));
  applyAction(game, playerId, { type: "PLAY_SELECTED" }, tools);

  assert.equal(game.phase, "await-draw");
  assert.equal(game.hands[playerId].length, 1);
  assert.equal(game.pendingDiscard.length, 2);

  applyAction(game, playerId, { type: "DRAW_DECK" }, tools);
  assert.equal(game.hands[playerId].length, 2);
  assert.equal(game.pendingDiscard.length, 0);
  assert.equal(game.discard.at(-1).length, 2);
  assert.equal(game.currentPlayerId, opponentId);
});

test("drawing from the previous discard leaves the played meld on top", () => {
  const { game, tools } = startedGame();
  const playerId = game.currentPlayerId;
  game.hands[playerId] = [card("2", "♣", "played"), card("8", "♦", "kept")];
  game.discard = [[card("K", "♥", "pickup")]];

  applyAction(game, playerId, { type: "TOGGLE_CARD", index: 0 }, tools);
  applyAction(game, playerId, { type: "PLAY_SELECTED" }, tools);
  assert.equal(viewForPlayer(game, playerId).discard[0].id, "pickup");
  applyAction(game, playerId, { type: "DRAW_DISCARD" }, tools);

  assert.deepEqual(game.hands[playerId].map((candidate) => candidate.id), ["kept", "pickup"]);
  assert.deepEqual(game.discard.at(-1).map((candidate) => candidate.id), ["played"]);
});

test("an invalid multi-card selection cannot be played", () => {
  const { game, tools } = startedGame();
  const playerId = game.currentPlayerId;
  game.hands[playerId] = [card("3", "♦"), card("5", "♣")];
  applyAction(game, playerId, { type: "TOGGLE_CARD", index: 0 }, tools);
  applyAction(game, playerId, { type: "TOGGLE_CARD", index: 1 }, tools);

  assert.ok(!viewForPlayer(game, playerId).legalActions.includes("PLAY_SELECTED"));
  assert.throws(
    () => applyAction(game, playerId, { type: "PLAY_SELECTED" }, tools),
    (error) => error instanceof GameRuleError,
  );
});

test("a successful Yaniv call gives the opponent hand value to the opponent", () => {
  const { game, tools } = startedGame();
  const caller = game.currentPlayerId;
  const opponent = game.players.find((player) => player.id !== caller).id;
  game.hands[caller] = [card("2"), card("3")];
  game.hands[opponent] = [card("9"), card("K")];

  applyAction(game, caller, { type: "CALL_YANIV" }, tools);

  assert.equal(game.status, "round-finished");
  assert.equal(game.assaf, false);
  assert.equal(game.roundWinnerId, caller);
  assert.equal(game.roundScores[caller], 0);
  assert.equal(game.roundScores[opponent], 19);
  assert.ok(viewForPlayer(game, caller).players.every((player) => player.hand.every((candidate) => !candidate.hidden)));
});

test("Yaniv cannot be called above five points", () => {
  const { game, tools } = startedGame();
  const caller = game.currentPlayerId;
  game.hands[caller] = [card("6")];

  assert.ok(!viewForPlayer(game, caller).legalActions.includes("CALL_YANIV"));
  assert.throws(
    () => applyAction(game, caller, { type: "CALL_YANIV" }, tools),
    (error) => error instanceof GameRuleError,
  );
});

test("an equal or lower opponent hand causes a thirty-point Assaf penalty", () => {
  const { game, tools } = startedGame();
  const caller = game.currentPlayerId;
  const opponent = game.players.find((player) => player.id !== caller).id;
  game.hands[caller] = [card("2"), card("3")];
  game.hands[opponent] = [card("A"), card("4")];

  applyAction(game, caller, { type: "CALL_YANIV" }, tools);

  assert.equal(game.assaf, true);
  assert.equal(game.roundWinnerId, opponent);
  assert.equal(game.roundScores[caller], 5 + ASSAF_PENALTY);
  assert.equal(game.roundScores[opponent], 0);
});

test("both players must ready up before the next round", () => {
  const { game, tools } = startedGame();
  const caller = game.currentPlayerId;
  const opponent = game.players.find((player) => player.id !== caller).id;
  game.hands[caller] = [card("A")];
  game.hands[opponent] = [card("K")];
  applyAction(game, caller, { type: "CALL_YANIV" }, tools);
  const previousStarter = game.startingPlayerId;

  applyAction(game, caller, { type: "READY_NEXT" }, tools);
  assert.equal(game.status, "round-finished");
  applyAction(game, opponent, { type: "READY_NEXT" }, tools);

  assert.equal(game.status, "playing");
  assert.equal(game.roundNumber, 2);
  assert.notEqual(game.startingPlayerId, previousStarter);
});

test("reaching the match limit ends the match with the lower total as winner", () => {
  const { game, tools } = startedGame();
  const caller = game.currentPlayerId;
  const opponent = game.players.find((player) => player.id !== caller).id;
  game.scores[caller] = MATCH_LIMIT - 10;
  game.hands[caller] = [card("5")];
  game.hands[opponent] = [card("A")];

  applyAction(game, caller, { type: "CALL_YANIV" }, tools);

  assert.equal(game.status, "match-finished");
  assert.deepEqual(game.matchWinnerIds, [opponent]);
});
