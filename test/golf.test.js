import assert from "node:assert/strict";
import test from "node:test";

import {
  canPlayOnWaste,
  cardsRemaining,
  createGolfGame,
  drawStockCard,
  playTableauCard,
  undoGolfMove,
} from "../src/client/golf.js";

function card(rank, suit = "♠", id = `${rank}${suit}`) {
  return { rank, suit, id };
}

function deterministicTools() {
  let nextId = 0;
  return { idFactory: () => `golf-${nextId++}`, randomInt: () => 0 };
}

test("Golf deals seven five-card columns, a waste card, and a sixteen-card stock", () => {
  const game = createGolfGame(deterministicTools());

  assert.deepEqual(game.tableau.map((column) => column.length), [5, 5, 5, 5, 5, 5, 5]);
  assert.equal(game.stock.length, 16);
  assert.ok(game.waste);
  assert.equal(cardsRemaining(game), 35);
});

test("Golf accepts adjacent ranks and wraps King to Ace", () => {
  assert.equal(canPlayOnWaste(card("7"), card("6")), true);
  assert.equal(canPlayOnWaste(card("A"), card("K")), true);
  assert.equal(canPlayOnWaste(card("K"), card("A")), true);
  assert.equal(canPlayOnWaste(card("9"), card("6")), false);
});

test("a tableau play can be undone exactly", () => {
  const game = {
    stock: [card("Q", "♦", "stock")],
    waste: card("6", "♣", "waste"),
    tableau: [[card("7", "♥", "play")], [], [], [], [], [], []],
    moves: 4,
    status: "playing",
    history: [{ type: "deal" }],
    undoStack: [],
  };

  playTableauCard(game, 0);
  assert.equal(game.waste.id, "play");
  assert.equal(cardsRemaining(game), 0);
  assert.equal(game.status, "won");

  assert.equal(undoGolfMove(game), true);
  assert.equal(game.waste.id, "waste");
  assert.equal(game.tableau[0].length, 1);
  assert.equal(game.moves, 4);
  assert.equal(game.status, "playing");
});

test("an empty stock ends the game only once there are no playable cards", () => {
  const game = {
    stock: [card("Q", "♦", "stock")],
    waste: card("6", "♣", "waste"),
    tableau: [[card("7", "♥", "play")], [card("10", "♥", "stuck")], [], [], [], [], []],
    moves: 0,
    status: "playing",
    history: [{ type: "deal" }],
    undoStack: [],
  };

  drawStockCard(game);
  assert.equal(game.status, "lost");
});
