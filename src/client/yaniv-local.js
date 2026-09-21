import { GameRuleError } from "../shared/games/errors.js";
import {
  addPlayer,
  applyAction,
  createGame,
  viewForPlayer,
} from "../shared/games/yaniv.js";
import {
  chooseComputerDraw,
  chooseComputerMeld,
  COMPUTER_LEVELS,
  isComputerLevel,
  shouldComputerCallYaniv,
} from "./yaniv-ai.js";
import { CARD_MOVE_MS, cardDealDuration } from "./card-motion.js?v=slower-motion";
import { setupLobby } from "./lobby.js";
import { createYanivTable } from "./yaniv-ui.js?v=slower-motion";

const YOU = { id: "local-you", name: "you" };
const COMPUTER = { id: "local-computer", name: "computer" };

let game = null;
let gameToken = 0;
let ui = null;
let selectedLevel = savedLevel();
let activeLevel = selectedLevel;

export function startLocalYaniv() {
  ui = createYanivTable({
    dispatch: playerAction,
    onNewGame: startGame,
    getComputerLevel: () => selectedLevel,
    getActiveComputerLevel: () => activeLevel,
    onComputerLevelChange: setComputerLevel,
  });
  setupLobby({ gameType: "yaniv" });
  startGame();
}

function startGame() {
  gameToken += 1;
  activeLevel = selectedLevel;
  const tools = randomTools();
  game = createGame({ roomCode: "LOCAL", host: YOU });
  addPlayer(game, COMPUTER, tools);
  render();
  queueComputerTurn({ dealtCards: 10 });
}

function playerAction(action) {
  try {
    applyAction(game, YOU.id, action, randomTools());
    completeReadyPair(action.type);
    render();
    const newRound = (action.type === "READY_NEXT" || action.type === "REMATCH") && game.status === "playing";
    queueComputerTurn({ dealtCards: newRound ? 10 : 0 });
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
  const view = viewForPlayer(game, YOU.id);
  ui.render(view, { computerLevel: activeLevel, ...(message ? { message } : {}) });
}

function queueComputerTurn({ dealtCards = 0 } = {}) {
  if (game.status !== "playing" || game.currentPlayerId !== COMPUTER.id) return;
  const token = gameToken;
  const delay = dealtCards ? cardDealDuration(dealtCards) + 300 : CARD_MOVE_MS + 450;
  setTimeout(() => takeComputerTurn(token), delay);
}

async function takeComputerTurn(token) {
  if (token !== gameToken || game.status !== "playing" || game.currentPlayerId !== COMPUTER.id) return;
  const tools = randomTools();
  const hand = game.hands[COMPUTER.id];

  if (shouldComputerCallYaniv({
    hand,
    opponentHandCount: game.hands[YOU.id].length,
    level: activeLevel,
  })) {
    applyAction(game, COMPUTER.id, { type: "CALL_YANIV" }, tools);
    render();
    return;
  }

  for (const index of chooseComputerMeld(hand, { level: activeLevel })) {
    applyAction(game, COMPUTER.id, { type: "TOGGLE_CARD", index }, tools);
  }
  render(`${COMPUTER.name} is choosing a play…`);

  await wait(360);
  if (token !== gameToken || game.status !== "playing" || game.currentPlayerId !== COMPUTER.id) return;
  applyAction(game, COMPUTER.id, { type: "PLAY_SELECTED" }, tools);
  render(`${COMPUTER.name} played. Drawing one card…`);

  await wait(760);
  if (token !== gameToken || game.status !== "playing" || game.currentPlayerId !== COMPUTER.id) return;
  const discardCard = game.discard.at(-1)?.at(-1);
  const draw = chooseComputerDraw({
    hand: game.hands[COMPUTER.id],
    discardCard,
    seenCards: [...game.discard.flat(), ...game.pendingDiscard],
    level: activeLevel,
  });
  applyAction(game, COMPUTER.id, { type: draw }, tools);
  render();
}

function setComputerLevel(level) {
  if (!isComputerLevel(level)) return;
  selectedLevel = level;
  try { localStorage.setItem("yaniv-level", level); } catch {}
}

function savedLevel() {
  try {
    const saved = localStorage.getItem("yaniv-level");
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
