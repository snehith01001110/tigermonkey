import { GameRuleError } from "../shared/games/errors.js";
import { addPlayer, applyAction, createGame, viewForPlayer } from "../shared/games/scopa.js";
import { COMPUTER_LEVELS, chooseComputerMove, isComputerLevel } from "./scopa-ai.js";
import { setupLobby } from "./lobby.js";
import { createScopaTable } from "./scopa-ui.js";

const YOU = { id: "local-you", name: "you" };
const COMPUTER = { id: "local-computer", name: "computer" };

let game = null;
let gameToken = 0;
let ui = null;
let selectedLevel = savedLevel();
let activeLevel = selectedLevel;

export function startLocalScopa() {
  ui = createScopaTable({
    dispatch: playerAction,
    onNewGame: startGame,
    getComputerLevel: () => selectedLevel,
    getActiveComputerLevel: () => activeLevel,
    onComputerLevelChange: setComputerLevel,
  });
  setupLobby({ gameType: "scopa" });
  startGame();
}

function startGame() {
  gameToken += 1;
  activeLevel = selectedLevel;
  const tools = randomTools();
  game = createGame({ roomCode: "LOCAL", host: YOU });
  addPlayer(game, COMPUTER, tools);
  render();
  queueComputerTurn();
}

function playerAction(action) {
  try {
    applyAction(game, YOU.id, action, randomTools());
    completeReadyPair(action.type);
    render();
    queueComputerTurn();
  } catch (error) {
    if (error instanceof GameRuleError) render(error.message);
    else throw error;
  }
}

function completeReadyPair(actionType) {
  if (actionType === "READY_NEXT" && game.status === "round-finished") {
    applyAction(game, COMPUTER.id, { type: "READY_NEXT" }, randomTools());
  } else if (actionType === "REMATCH" && game.status === "match-finished") {
    applyAction(game, COMPUTER.id, { type: "REMATCH" }, randomTools());
  }
}

function render(message = "") {
  ui.render(viewForPlayer(game, YOU.id), {
    computerLevel: activeLevel,
    ...(message ? { message } : {}),
  });
}

function queueComputerTurn() {
  if (game.status !== "playing" || game.currentPlayerId !== COMPUTER.id) return;
  const token = gameToken;
  setTimeout(() => takeComputerTurn(token), 650);
}

function takeComputerTurn(token) {
  if (token !== gameToken || game.status !== "playing" || game.currentPlayerId !== COMPUTER.id) return;
  const tools = randomTools();
  const move = chooseComputerMove({
    hand: game.hands[COMPUTER.id],
    table: game.table,
    level: activeLevel,
    randomInt: tools.randomInt,
  });
  if (!move) return;

  applyAction(game, COMPUTER.id, { type: "PLAY_CARD", ...move }, tools);
  render();
}

function setComputerLevel(level) {
  if (!isComputerLevel(level)) return;
  selectedLevel = level;
  try { localStorage.setItem("scopa-level", level); } catch {}
}

function savedLevel() {
  try {
    const saved = localStorage.getItem("scopa-level");
    if (COMPUTER_LEVELS.includes(saved)) return saved;
  } catch {}
  return "easy";
}

function randomTools() {
  return {
    idFactory: () => crypto.randomUUID(),
    randomInt(max) {
      const range = 0x1_0000_0000;
      const ceiling = Math.floor(range / max) * max;
      const value = new Uint32Array(1);
      do crypto.getRandomValues(value);
      while (value[0] >= ceiling);
      return value[0] % max;
    },
  };
}
