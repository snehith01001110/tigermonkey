import * as cabo from "./cabo.js";

const games = new Map([
  [
    cabo.CABO_GAME_TYPE,
    {
      create: cabo.createGame,
      addPlayer: cabo.addPlayer,
      applyAction: cabo.applyAction,
      viewForPlayer: cabo.viewForPlayer,
    },
  ],
]);

export function getGameModule(gameType) {
  const game = games.get(gameType);
  if (!game) throw new Error(`Unsupported game type: ${gameType}`);
  return game;
}

export function supportedGameTypes() {
  return [...games.keys()];
}
