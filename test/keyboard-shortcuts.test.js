import assert from "node:assert/strict";
import test from "node:test";

import { shortcutForDescriptor } from "../src/client/keyboard.js";

function key(descriptor) {
  return shortcutForDescriptor(descriptor)?.key;
}

test("the first four player and opponent cards use the requested number rows", () => {
  assert.deepEqual(
    Array.from({ length: 4 }, (_, index) => key({ owner: "player", index })),
    ["1", "2", "3", "4"],
  );
  assert.deepEqual(
    Array.from({ length: 4 }, (_, index) => key({ owner: "opponent", index })),
    ["5", "6", "7", "8"],
  );
  assert.equal(key({ owner: "ai", index: 0 }), "5");
});

test("piles and contextual actions have mnemonic shortcuts", () => {
  assert.equal(key({ id: "deck" }), "d");
  assert.equal(key({ id: "discard" }), "x");
  assert.equal(key({ label: "discard · peek yours" }), "x");
  assert.equal(key({ label: "match discard" }), "m");
  assert.equal(key({ label: "call cabo" }), "c");
  assert.equal(key({ label: "keep hands" }), "k");
  assert.equal(key({ label: "swap" }), "s");
  assert.equal(key({ label: "skip" }), "s");
  assert.equal(key({ label: "cancel" }), "escape");
  assert.equal(key({ label: "got it" }), "enter");
  assert.equal(key({ label: "play again" }), "enter");
});
