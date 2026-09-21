import { CARD_MOVE_MS } from "./card-motion.js?v=stable-mobile-selection";

export const SCORE_COUNT_MS = 520;

const EASING = "cubic-bezier(.2, .75, .25, 1)";

// Run the same reveal-then-count rhythm for any card game. Renderers own their game
// state while this suite owns the timing and small physical score effects.
export async function runScoreCount({
  hands,
  shouldContinue = () => true,
  onHandStart = () => {},
  onCard = () => {},
  onHandEnd = () => {},
} = {}) {
  if (prefersReducedMotion()) return shouldContinue();

  await wait(CARD_MOVE_MS + 240);
  for (const hand of hands) {
    if (!shouldContinue()) return false;
    onHandStart(hand);
    for (let index = 0; index < hand.cards.length; index += 1) {
      const card = hand.cards[index];
      if (!card) continue;
      onCard(hand, card, index);
      await wait(SCORE_COUNT_MS);
      if (!shouldContinue()) return false;
    }
    onHandEnd(hand);
    await wait(300);
  }
  return shouldContinue();
}

export function scoreValueBadge(value) {
  const badge = document.createElement("span");
  badge.className = "card-value";
  badge.textContent = formatScore(value);
  badge.setAttribute("aria-label", `worth ${value}`);
  return badge;
}

export function revealScoreCard(card, value) {
  if (!card) return;
  card.classList.add("counting");
  if (!card.querySelector(".card-value")) card.appendChild(scoreValueBadge(value));
  setTimeout(() => {
    card.classList.remove("counting");
    card.classList.add("counted");
  }, 300);

  const chip = document.createElement("span");
  chip.className = "count-chip";
  chip.textContent = formatScore(value);
  card.appendChild(chip);
  if (prefersReducedMotion()) {
    setTimeout(() => chip.remove(), 700);
    return;
  }
  chip
    .animate(
      [
        { transform: "translate(-50%, 6px)", opacity: 0 },
        { transform: "translate(-50%, -6px)", opacity: 1, offset: 0.3 },
        { transform: "translate(-50%, -24px)", opacity: 0 },
      ],
      { duration: 900, easing: EASING },
    )
    .finished.then(() => chip.remove(), () => chip.remove());
}

export function setTallyValue(tally, value) {
  const total = tally.querySelector(".tally-total");
  total.textContent = String(value);
  if (prefersReducedMotion()) return;
  total.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.24)" }, { transform: "scale(1)" }],
    { duration: 320, easing: "ease-out" },
  );
}

export function formatScore(value) {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
