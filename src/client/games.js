export const GAME_CATALOG = Object.freeze([
  {
    id: "cabo",
    name: "cabo",
  },
  {
    id: "yaniv",
    name: "yaniv",
  },
  {
    id: "golf",
    name: "golf solitaire",
    multiplayer: false,
  },
  {
    id: "dice",
    name: "dice",
    multiplayer: false,
  },
]);

export function isGameType(value) {
  return GAME_CATALOG.some((game) => game.id === value);
}
