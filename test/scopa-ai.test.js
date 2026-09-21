import assert from "node:assert/strict";
import test from "node:test";

import { chooseComputerMove, legalScopaMoves } from "../src/client/scopa-ai.js";

function card(rank, suit = "♠", id = `${rank}${suit}`) {
  return { rank, suit, id };
}

test("Scopa AI enumerates every capture choice and non-capturing play", () => {
  const hand = [card("5", "♣", "play-five"), card("K", "♣", "play-king")];
  const table = [card("A", "♠", "ace"), card("4", "♥", "four")];
  const moves = legalScopaMoves(hand, table);

  assert.deepEqual(moves, [
    { handIndex: 0, captureIds: ["ace", "four"] },
    { handIndex: 1, captureIds: [] },
  ]);
});

test("hard Scopa AI takes a sweep when one is available", () => {
  const move = chooseComputerMove({
    hand: [card("5", "♣", "five"), card("K", "♣", "king")],
    table: [card("A", "♠", "ace"), card("4", "♥", "four")],
    level: "hard",
    randomInt: () => 0,
  });

  assert.deepEqual(move, { handIndex: 0, captureIds: ["ace", "four"] });
});

test("medium Scopa AI protects the seven of diamonds when another play exists", () => {
  const move = chooseComputerMove({
    hand: [card("7", "♦", "settebello"), card("K", "♣", "king")],
    table: [card("2", "♠", "two")],
    level: "medium",
    randomInt: () => 0,
  });

  assert.equal(move.handIndex, 1);
});
