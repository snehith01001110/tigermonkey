import * as cabo from "./cabo.js";
import * as yaniv from "./yaniv.js";

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
  [
    yaniv.YANIV_GAME_TYPE,
    {
      create: yaniv.createGame,
      addPlayer: yaniv.addPlayer,
      applyAction: yaniv.applyAction,
      viewForPlayer: yaniv.viewForPlayer,
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
