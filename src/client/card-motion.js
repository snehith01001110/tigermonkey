export const CARD_MOVE_MS = 460;

const CARD_SELECTOR = ".card[data-card-id]";
const MOTION_EASING = "cubic-bezier(.2, .75, .25, 1)";

export function snapshotCards(root = document) {
  const snapshot = new Map();
  for (const card of root.querySelectorAll(CARD_SELECTOR)) {
    snapshot.set(card.dataset.cardId, {
      rect: card.getBoundingClientRect(),
      width: card.offsetWidth,
      faceUp: card.classList.contains("face-up"),
    });
  }
  return snapshot;
}

// Rebuild-friendly FLIP motion for every card table. Existing cards travel from their
// previous position; new cards emerge from the deck in their declared deal order.
export function animateCards(before, { root = document, deck = root.querySelector("#deck"), dealDelay = 90 } = {}) {
  if (prefersReducedMotion() || !deck) return;

  const deckCard = deck.querySelector(".deck-layer:last-child") || deck;
  const deckRect = deckCard.getBoundingClientRect();
  if (!deckRect.width || !deckRect.height) return;

  const fromDeck = { rect: deckRect, width: deckRect.width, faceUp: false };
  const dealt = [];

  for (const card of root.querySelectorAll(CARD_SELECTOR)) {
    const previous = before.get(card.dataset.cardId);
    if (previous) animateCard(card, previous, 0);
    else if (!card.dataset.under) dealt.push(card);
  }

  dealt
    .sort((a, b) => Number(a.dataset.deal || 0) - Number(b.dataset.deal || 0))
    .forEach((card, index) => animateCard(card, fromDeck, index * dealDelay));
}

function animateCard(card, from, delay) {
  const to = card.getBoundingClientRect();
  const dx = from.rect.left + from.rect.width / 2 - (to.left + to.width / 2);
  const dy = from.rect.top + from.rect.height / 2 - (to.top + to.height / 2);
  const scale = from.width / card.offsetWidth;
  const timing = { duration: CARD_MOVE_MS, delay, easing: MOTION_EASING, fill: "backwards" };

  if (Math.abs(dx) + Math.abs(dy) > 1 || Math.abs(scale - 1) > 0.01) {
    card.style.zIndex = "10";
    const lift = ((scale + 1) / 2) * 1.06;
    const movement = card.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
        { transform: `translate(${dx / 2}px, ${dy / 2}px) scale(${lift})`, offset: 0.5 },
        { transform: "translate(0, 0) scale(1)" },
      ],
      { ...timing, composite: "add" },
    );
    movement.finished.then(() => { card.style.zIndex = ""; }, () => {});
  }

  const faceUp = card.classList.contains("face-up");
  if (faceUp !== from.faceUp) {
    card.querySelector(".card-inner")?.animate(
      [{ transform: `rotateY(${from.faceUp ? 180 : 0}deg)` }, { transform: `rotateY(${faceUp ? 180 : 0}deg)` }],
      timing,
    );
  }
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
