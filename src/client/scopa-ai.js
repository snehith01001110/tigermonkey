import { RANKS, captureOptions } from "../shared/games/scopa.js";

export const COMPUTER_LEVELS = ["easy", "medium", "hard"];

const PRIMIERA_WEIGHT = Object.freeze({
  A: 1.6,
  2: 1.2,
  3: 1.3,
  4: 1.4,
  5: 1.5,
  6: 1.8,
  7: 2.1,
  J: 1,
  Q: 1,
  K: 1,
});

export function isComputerLevel(value) {
  return COMPUTER_LEVELS.includes(value);
}

export function legalScopaMoves(hand, table) {
  return hand.flatMap((card, handIndex) => {
    const options = captureOptions(table, card);
    return (options.length ? options : [[]]).map((captureIds) => ({ handIndex, captureIds }));
  });
}

export function chooseComputerMove({ hand, table, level = "easy", randomInt = defaultRandomInt }) {
  const moves = legalScopaMoves(hand, table);
  if (!moves.length) return null;
  if (level === "easy") return moves[randomInt(moves.length)];

  const ranked = moves.map((move) => ({
    move,
    score: evaluateMove(move, hand, table, level),
  }));
  const high = Math.max(...ranked.map((candidate) => candidate.score));
  const best = ranked.filter((candidate) => candidate.score === high);
  return best[randomInt(best.length)].move;
}

function evaluateMove(move, hand, table, level) {
  const played = hand[move.handIndex];
  const chosen = new Set(move.captureIds);
  const captured = table.filter((card) => chosen.has(card.id));
  const after = captured.length
    ? table.filter((card) => !chosen.has(card.id))
    : [...table, played];

  let score = captured.length * 2.4;
  for (const card of [...captured, ...(captured.length ? [played] : [])]) {
    if (card.suit === "♦") score += 1.5;
    if (card.rank === "7" && card.suit === "♦") score += 8;
    score += PRIMIERA_WEIGHT[card.rank] * 0.35;
  }
  if (captured.length && after.length === 0) score += 9;

  if (!captured.length) {
    if (played.rank === "7" && played.suit === "♦") score -= 10;
    if (played.suit === "♦") score -= 1.4;
    score -= PRIMIERA_WEIGHT[played.rank] * 0.25;
  }

  if (level === "hard") {
    score -= tableRisk(after) * 0.9;
    // Prefer a play that leaves useful capture choices in the rest of the hand.
    const flexibility = hand.reduce((total, card, index) => (
      index === move.handIndex ? total : total + captureOptions(after, card).length
    ), 0);
    score += flexibility * 0.2;
  }

  return score;
}

function tableRisk(table) {
  let risk = 0;
  for (const rank of RANKS) {
    const probe = { rank, suit: "♠", id: `probe-${rank}` };
    for (const option of captureOptions(table, probe)) {
      const cards = table.filter((card) => option.includes(card.id));
      let value = cards.length;
      if (cards.some((card) => card.rank === "7" && card.suit === "♦")) value += 5;
      value += cards.filter((card) => card.suit === "♦").length * 0.8;
      if (option.length === table.length) value += 5;
      risk = Math.max(risk, value);
    }
  }
  return risk;
}

function defaultRandomInt(max) {
  return Math.floor(Math.random() * max);
}
