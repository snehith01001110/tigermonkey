import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseComputerDraw,
  chooseComputerMeld,
  shouldComputerCallYaniv,
} from "../src/client/yaniv-ai.js";

function card(rank, suit = "♠", id = `${rank}${suit}`) {
  return { rank, suit: rank === "JOKER" ? "" : suit, id };
}

test("medium and hard Yaniv computers keep a discard that completes a run", () => {
  const hand = [card("5", "♣", "five"), card("6", "♣", "six")];
  const discardCard = card("7", "♣", "seven");

  assert.equal(chooseComputerDraw({ hand, discardCard, level: "easy" }), "DRAW_DECK");
  assert.equal(chooseComputerDraw({ hand, discardCard, level: "medium" }), "DRAW_DISCARD");
  assert.equal(chooseComputerDraw({ hand, discardCard, level: "hard" }), "DRAW_DISCARD");
});

test("hard Yaniv preserves a future run when a low single-card discard is available", () => {
  const hand = [
    card("3", "♦", "three"),
    card("4", "♦", "four"),
    card("5", "♦", "five"),
    card("5", "♣", "five-clubs"),
  ];

  assert.deepEqual(chooseComputerMeld(hand, { level: "medium" }), [0, 1, 2]);
  assert.deepEqual(chooseComputerMeld(hand, { level: "hard" }), [3]);
});

test("hard Yaniv avoids a risky five-point call against a one-card opponent", () => {
  const hand = [card("2"), card("3")];

  assert.equal(shouldComputerCallYaniv({ hand, opponentHandCount: 1, level: "easy" }), true);
  assert.equal(shouldComputerCallYaniv({ hand, opponentHandCount: 1, level: "hard" }), false);
  assert.equal(shouldComputerCallYaniv({ hand, opponentHandCount: 3, level: "hard" }), true);
});
