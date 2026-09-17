import assert from "node:assert/strict";
import test from "node:test";

import { gameTypeFromUrl, gameUrl, roomUrl, selectedGameTypeFromUrl } from "../src/client/config.js";

test("game and room URLs preserve every local game while Cabo remains the default", () => {
  globalThis.location = { href: "https://tigermonkey.com/?game=yaniv&room=OLD123#table" };

  assert.equal(gameTypeFromUrl(), "yaniv");
  assert.equal(selectedGameTypeFromUrl(), "yaniv");
  assert.equal(gameUrl("cabo"), "https://tigermonkey.com/?game=cabo");
  assert.equal(gameUrl("yaniv"), "https://tigermonkey.com/?game=yaniv");
  assert.equal(gameUrl("golf"), "https://tigermonkey.com/?game=golf");
  assert.equal(gameUrl("dice"), "https://tigermonkey.com/?game=dice");
  assert.equal(roomUrl("abc234", "cabo"), "https://tigermonkey.com/?game=cabo&room=ABC234");
  assert.equal(roomUrl("abc234", "yaniv"), "https://tigermonkey.com/?game=yaniv&room=ABC234");
});

test("a bare root has no selected game and falls back to Cabo only for legacy links", () => {
  globalThis.location = { href: "https://tigermonkey.com/" };

  assert.equal(selectedGameTypeFromUrl(), null);
  assert.equal(gameTypeFromUrl(), "cabo");
});
