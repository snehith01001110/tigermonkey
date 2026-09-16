import { isValidMeld, scoreCard } from "../shared/games/yaniv.js";

export const COMPUTER_LEVELS = Object.freeze(["easy", "medium", "hard"]);

const FULL_DECK_TOTAL = 340;
const FULL_DECK_COUNT = 54;
const CARD_VALUE_COUNTS = Object.freeze([
  2, // Jokers
  4, 4, 4, 4, 4, 4, 4, 4, 4, // A through 9
  16, // 10s and face cards
]);

export function isComputerLevel(level) {
  return COMPUTER_LEVELS.includes(level);
}

export function chooseComputerMeld(hand, { level = "easy" } = {}) {
  const candidates = meldCandidates(hand);
  let best = [0];
  let bestValue = -Infinity;

  for (const indices of candidates) {
    const cards = indices.map((index) => hand[index]);
    const points = cards.reduce((total, card) => total + scoreCard(card), 0);
    let value;

    if (level === "easy") {
      // Keep the original opponent's straightforward preference for shedding cards.
      value = cards.length * 20 + points;
    } else {
      const remaining = hand.filter((_, index) => !indices.includes(index));
      const future = bestMultiMeldValue(remaining);
      const cardBonus = level === "hard" ? 8 : 9;
      const futureWeight = level === "hard" ? 0.75 : 0.35;
      value = points + cards.length * cardBonus + future * futureWeight;
    }

    if (value > bestValue || (value === bestValue && indices.length > best.length)) {
      best = indices;
      bestValue = value;
    }
  }
  return best;
}

export function chooseComputerDraw({ hand, discardCard, seenCards = [], level = "easy" }) {
  if (!discardCard) return "DRAW_DECK";
  const discardValue = scoreCard(discardCard);
  if (level === "easy") return discardValue <= 4 ? "DRAW_DISCARD" : "DRAW_DECK";

  const meldGain = futureMeldGain(hand, discardCard);
  if (level === "medium") {
    return discardValue <= 4 || meldGain >= 20 ? "DRAW_DISCARD" : "DRAW_DECK";
  }

  const expectedDeckValue = unseenDeckAverage(hand, seenCards);
  return discardValue + 0.35 < expectedDeckValue || meldGain >= 16 ? "DRAW_DISCARD" : "DRAW_DECK";
}

export function shouldComputerCallYaniv({ hand, opponentHandCount, level = "easy" }) {
  const value = hand.reduce((total, card) => total + scoreCard(card), 0);
  if (value > 5) return false;
  if (level === "easy") return true;

  const assafRisk = estimatedAssafRisk(opponentHandCount, value);
  if (level === "medium") return value <= 3 || assafRisk < 0.14;
  return assafRisk < 0.24;
}

export function estimatedAssafRisk(cardCount, targetValue) {
  if (!Number.isInteger(cardCount) || cardCount < 1) return 0;
  let distribution = [1];
  for (let card = 0; card < cardCount; card += 1) {
    const next = Array(distribution.length + 10).fill(0);
    distribution.forEach((chance, total) => {
      CARD_VALUE_COUNTS.forEach((count, value) => {
        next[total + value] += chance * (count / FULL_DECK_COUNT);
      });
    });
    distribution = next;
  }
  return distribution.slice(0, targetValue + 1).reduce((total, chance) => total + chance, 0);
}

function meldCandidates(hand) {
  const candidates = [];
  for (let mask = 1; mask < 2 ** hand.length; mask += 1) {
    const indices = [];
    for (let index = 0; index < hand.length; index += 1) {
      if (mask & (1 << index)) indices.push(index);
    }
    if (isValidMeld(indices.map((index) => hand[index]))) candidates.push(indices);
  }
  return candidates;
}

function bestMultiMeldValue(hand) {
  let best = 0;
  for (const indices of meldCandidates(hand)) {
    if (indices.length < 2) continue;
    const cards = indices.map((index) => hand[index]);
    const value = cards.reduce((total, card) => total + scoreCard(card), 0) + cards.length * 7;
    best = Math.max(best, value);
  }
  return best;
}

function futureMeldGain(hand, card) {
  return bestMultiMeldValue([...hand, card]) - bestMultiMeldValue(hand);
}

function unseenDeckAverage(hand, seenCards) {
  const known = new Map();
  for (const card of [...hand, ...seenCards]) {
    if (card?.id) known.set(card.id, card);
  }
  const knownValue = [...known.values()].reduce((total, card) => total + scoreCard(card), 0);
  const unknownCount = FULL_DECK_COUNT - known.size;
  return unknownCount > 0 ? (FULL_DECK_TOTAL - knownValue) / unknownCount : FULL_DECK_TOTAL / FULL_DECK_COUNT;
}
