import assert from "node:assert/strict";
import test from "node:test";

import { animateCards, snapshotCards } from "../src/client/card-motion.js";

function fakeCard({ id = "card-1", zone = "playerHand", top = 0 } = {}) {
  let zoneId = zone;
  let rectTop = top;
  let animationCount = 0;
  const card = {
    dataset: { cardId: id, owner: "player", index: "0" },
    classList: { contains: (name) => name === "face-up" },
    style: { zIndex: "" },
    offsetWidth: 70,
    getBoundingClientRect: () => ({ left: 0, top: rectTop, width: 70, height: 100 }),
    closest: () => ({ id: zoneId }),
    querySelector: () => null,
    animate: () => {
      animationCount += 1;
      return { finished: Promise.resolve() };
    },
    moveTo(nextZone, nextTop) {
      zoneId = nextZone;
      rectTop = nextTop;
    },
    get animationCount() {
      return animationCount;
    },
  };
  return card;
}

function fakeRoot(card) {
  return { querySelectorAll: () => [card] };
}

function fakeDeck() {
  const layer = { getBoundingClientRect: () => ({ left: 100, top: 100, width: 70, height: 100 }) };
  return { querySelector: () => layer };
}

test("selection-only layout changes do not animate the whole card table", () => {
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const card = fakeCard();
  const root = fakeRoot(card);
  const before = snapshotCards(root);

  card.moveTo("playerHand", -8);
  animateCards(before, { root, deck: fakeDeck() });

  assert.equal(card.animationCount, 0);
  delete globalThis.window;
});

test("a real card move still animates", async () => {
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const card = fakeCard();
  const root = fakeRoot(card);
  const before = snapshotCards(root);

  card.moveTo("discard", 60);
  animateCards(before, { root, deck: fakeDeck() });
  await Promise.resolve();

  assert.equal(card.animationCount, 1);
  delete globalThis.window;
});
