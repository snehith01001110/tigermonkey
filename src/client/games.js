export const GAME_CATALOG = Object.freeze([
  {
    id: "cabo",
    name: "cabo",
    description: "Memory, hidden cards, and a well-timed call.",
  },
  {
    id: "yaniv",
    name: "yaniv",
    description: "Build sets and runs, shed your hand, call it low.",
  },
  {
    id: "golf",
    name: "golf solitaire",
    description: "Clear seven columns with a quick sequence of cards.",
    multiplayer: false,
  },
]);

export function isGameType(value) {
  return GAME_CATALOG.some((game) => game.id === value);
}
