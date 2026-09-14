import { GameRuleError } from "../shared/games/errors.js";
import {
  addPlayer,
  applyAction,
  createGame,
  handValue,
  isValidMeld,
  scoreCard,
  viewForPlayer,
} from "../shared/games/yaniv.js";
import { setupLobby } from "./lobby.js";
import { createYanivTable } from "./yaniv-ui.js";

const YOU = { id: "local-you", name: "you" };
const COMPUTER = { id: "local-computer", name: "computer" };

let game = null;
let gameToken = 0;
let ui = null;

export function startLocalYaniv() {
  ui = createYanivTable({ dispatch: playerAction, onNewGame: startGame });
  setupLobby({ gameType: "yaniv" });
  startGame();
}

function startGame() {
  gameToken += 1;
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
  const view = viewForPlayer(game, YOU.id);
  ui.render(view, message ? { message } : {});
}

function queueComputerTurn() {
  if (game.status !== "playing" || game.currentPlayerId !== COMPUTER.id) return;
  const token = gameToken;
  setTimeout(() => takeComputerTurn(token), 650);
}

async function takeComputerTurn(token) {
  if (token !== gameToken || game.status !== "playing" || game.currentPlayerId !== COMPUTER.id) return;
  const tools = randomTools();
  const hand = game.hands[COMPUTER.id];

  if (handValue(hand) <= 5) {
    applyAction(game, COMPUTER.id, { type: "CALL_YANIV" }, tools);
    render();
    return;
  }

  for (const index of bestMeldIndices(hand)) {
    applyAction(game, COMPUTER.id, { type: "TOGGLE_CARD", index }, tools);
  }
  render(`${COMPUTER.name} is choosing a play…`);

  await wait(360);
  if (token !== gameToken || game.status !== "playing" || game.currentPlayerId !== COMPUTER.id) return;
  applyAction(game, COMPUTER.id, { type: "PLAY_SELECTED" }, tools);
  render(`${COMPUTER.name} played. Drawing one card…`);

  await wait(760);
  if (token !== gameToken || game.status !== "playing" || game.currentPlayerId !== COMPUTER.id) return;
  const available = game.discard.at(-1)?.at(-1);
  const drawDiscard = available && scoreCard(available) <= 4;
  applyAction(game, COMPUTER.id, { type: drawDiscard ? "DRAW_DISCARD" : "DRAW_DECK" }, tools);
  render();
}

function bestMeldIndices(hand) {
  let best = [0];
  let bestWeight = -1;
  for (let mask = 1; mask < 2 ** hand.length; mask += 1) {
    const indices = [];
    for (let index = 0; index < hand.length; index += 1) {
      if (mask & (1 << index)) indices.push(index);
    }
    const cards = indices.map((index) => hand[index]);
    if (!isValidMeld(cards)) continue;
    const weight = cards.length * 20 + cards.reduce((total, card) => total + scoreCard(card), 0);
    if (weight > bestWeight) {
      best = indices;
      bestWeight = weight;
    }
  }
  return best;
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
