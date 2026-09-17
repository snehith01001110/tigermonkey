import assert from "node:assert/strict";
import test from "node:test";

import { MAX_DIE_SIDES, MIN_DIE_SIDES, dieShapeForSides, normalizeDieSides, rollDie } from "../src/client/dice.js";
import { dieSvgMarkup } from "../src/client/dice-visual.js";

test("dice sides stay between four and two hundred", () => {
  assert.equal(normalizeDieSides(3), MIN_DIE_SIDES);
  assert.equal(normalizeDieSides(4), 4);
  assert.equal(normalizeDieSides(6.8), 6);
  assert.equal(normalizeDieSides(200), 200);
  assert.equal(normalizeDieSides(201), MAX_DIE_SIDES);
  assert.equal(normalizeDieSides("not a number", 12), 12);
});

test("a die rolls inclusively from zero through one less than its sides", () => {
  assert.equal(rollDie(6, () => 0), 0);
  assert.equal(rollDie(6, () => 5), 5);
  assert.equal(rollDie(200, () => 199), 199);
  assert.throws(() => rollDie(6, () => 6), RangeError);
});

test("the die becomes more faceted as its side count grows", () => {
  assert.equal(dieShapeForSides(4), "tetrahedron");
  assert.equal(dieShapeForSides(6), "cube");
  assert.equal(dieShapeForSides(8), "octahedron");
  assert.equal(dieShapeForSides(10), "trapezohedron");
  assert.equal(dieShapeForSides(12), "dodecahedron");
  assert.equal(dieShapeForSides(20), "icosahedron");
  assert.equal(dieShapeForSides(30), "multifaceted");
  assert.equal(dieShapeForSides(100), "zocchihedron");
});

test("every adaptive die shape has a scalable vector visual", () => {
  for (const sides of [4, 6, 8, 10, 12, 20, 30, 100]) {
    const markup = dieSvgMarkup(dieShapeForSides(sides));
    assert.match(markup, /^<svg/);
    assert.match(markup, /dice-shape-base/);
    assert.match(markup, /<\/svg>$/);
  }
});
