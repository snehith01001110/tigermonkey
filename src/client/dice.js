export const DEFAULT_DIE_SIDES = 6;
export const MIN_DIE_SIDES = 4;
export const MAX_DIE_SIDES = 200;

export function normalizeDieSides(value, fallback = DEFAULT_DIE_SIDES) {
  if (value === "" || value === null || value === undefined) return fallback;
  const sides = Number(value);
  if (!Number.isFinite(sides)) return fallback;
  return Math.min(MAX_DIE_SIDES, Math.max(MIN_DIE_SIDES, Math.trunc(sides)));
}

export function rollDie(sides, randomInt) {
  const normalizedSides = normalizeDieSides(sides);
  const value = randomInt(normalizedSides);
  if (!Number.isInteger(value) || value < 0 || value >= normalizedSides) {
    throw new RangeError("randomInt must return an integer from 0 up to the number of die sides.");
  }
  return value;
}

export function dieShapeForSides(value) {
  const sides = normalizeDieSides(value);
  if (sides <= 4) return "tetrahedron";
  if (sides <= 6) return "cube";
  if (sides <= 8) return "octahedron";
  if (sides <= 10) return "trapezohedron";
  if (sides <= 12) return "dodecahedron";
  if (sides <= 20) return "icosahedron";
  if (sides < 50) return "multifaceted";
  return "zocchihedron";
}
