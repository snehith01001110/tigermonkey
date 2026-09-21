import { prettyCard, powerFor, scoreCard } from "../shared/games/cabo.js";
import { CARD_MOVE_MS, animateCards, snapshotCards } from "./card-motion.js?v=mobile-scopa-rail";
import { revealScoreCard, runScoreCount, scoreValueBadge, setTallyValue } from "./score-motion.js?v=mobile-scopa-rail";
import { gameUrl, loadCredential, multiplayerApiBase, roomUrl } from "./config.js";
import { closeLobby, setupLobby, showWaitingRoom } from "./lobby.js";

const MOVE_MS = CARD_MOVE_MS;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const POWER_LABELS = {
  "peek-own": "peek yours",
  "peek-opponent": "peek theirs",
  "blind-swap": "blind swap",
  "swap-check": "swap, then check",
  "check-swap": "check, then swap",
};

const els = {
  aiHand: document.getElementById("aiHand"),
  playerHand: document.getElementById("playerHand"),
  deck: document.getElementById("deck"),
  deckStack: document.getElementById("deckStack"),
  deckCount: document.getElementById("deckCount"),
  held: document.getElementById("held"),
  discard: document.getElementById("discard"),
  turnLabel: document.getElementById("turnLabel"),
  message: document.getElementById("message"),
  actions: document.getElementById("actions"),
  historyList: document.getElementById("historyList"),
  historyListModal: document.getElementById("historyListModal"),
  historyBtn: document.getElementById("historyBtn"),
  historyDialog: document.getElementById("historyDialog"),
  closeHistoryBtn: document.getElementById("closeHistoryBtn"),
  multiplayerBtn: document.getElementById("multiplayerBtn"),
  closeMultiplayerBtn: document.getElementById("closeMultiplayerBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsDialog: document.getElementById("settingsDialog"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  computerSetting: document.getElementById("computerSetting"),
  themeRadios: document.querySelectorAll('input[name="theme"]'),
  themeColor: document.querySelector('meta[name="theme-color"]'),
  rulesBtn: document.getElementById("rulesBtn"),
  closeRulesBtn: document.getElementById("closeRulesBtn"),
  rulesDialog: document.getElementById("rulesDialog"),
  playerTally: document.getElementById("playerTally"),
  aiTally: document.getElementById("aiTally"),
  resultLine: document.getElementById("resultLine"),
  newGameBtn: document.getElementById("newGameBtn"),
};

let state = null;
let roomCode = "";
let credential = null;
let socket = null;
let connected = false;
let actionPending = false;
let reconnectDelay = 700;
let reconnectTimer = null;
let leaving = false;
let connectedPlayerIds = [];
let countedRound = null;
let countToken = 0;
let counting = false;
let countProgress = { player: 0, opponent: 0, active: null };

export function startOnlineGame(code) {
  roomCode = code;
  configurePage();
  setupLobby({
    roomCode,
    autoOpen: false,
    attachButton: false,
    onJoined: (joined) => {
      credential = joined;
      closeLobby();
      connect();
    },
  });

  credential = loadCredential(roomCode);
  if (credential) connect();
  else setupLobby({ roomCode, autoOpen: true, attachButton: false, onJoined: (joined) => {
    credential = joined;
    closeLobby();
    connect();
  } });
}

function configurePage() {
  els.multiplayerBtn.textContent = "leave game";
  els.newGameBtn.hidden = true;
  els.computerSetting.hidden = true;

  els.multiplayerBtn.addEventListener("click", leaveGame);
  els.closeMultiplayerBtn.addEventListener("click", () => {
    if (!state || state.status === "waiting") leaveGame();
  });
  els.deck.addEventListener("click", () => sendAction({ type: "DRAW_DECK" }));
  els.discard.addEventListener("click", () => sendAction({ type: "DRAW_DISCARD" }));
  els.rulesBtn.addEventListener("click", () => els.rulesDialog.showModal());
  els.closeRulesBtn.addEventListener("click", () => els.rulesDialog.close());
  els.historyBtn.addEventListener("click", () => els.historyDialog.showModal());
  els.closeHistoryBtn.addEventListener("click", () => els.historyDialog.close());
  els.settingsBtn.addEventListener("click", openSettings);
  els.closeSettingsBtn.addEventListener("click", () => els.settingsDialog.close());

  for (const radio of els.themeRadios) radio.addEventListener("change", () => applyTheme(radio.value));
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  darkQuery.addEventListener("change", updateThemeColor);
  updateThemeColor();

  window.addEventListener("beforeunload", () => {
    leaving = true;
    if (socket) socket.close(1000, "Page closed");
  });

  say("Connecting to the room…");
  els.turnLabel.textContent = "online game";
  renderEmptyTable();
}

function connect() {
  const apiBase = multiplayerApiBase();
  if (!apiBase) {
    say("Online play is not connected to its server yet.");
    setupLobby({ roomCode, autoOpen: true, attachButton: false, onJoined: (joined) => {
      credential = joined;
      closeLobby();
      connect();
    } });
    return;
  }

  clearTimeout(reconnectTimer);
  const url = new URL(`${apiBase}/api/rooms/${roomCode}/socket`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(url, ["tigermonkey", `token.${credential.token}`]);

  socket.addEventListener("open", () => {
    connected = true;
    actionPending = false;
    reconnectDelay = 700;
    render();
  });

  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "state") {
        if (payload.state.gameType !== "cabo") {
          location.replace(roomUrl(roomCode, payload.state.gameType));
          return;
        }
        state = payload.state;
        connectedPlayerIds = payload.connectedPlayerIds || [];
        actionPending = false;
        if (state.status === "waiting") showWaitingRoom(roomCode);
        else closeLobby();
        render();
      } else if (payload.type === "error") {
        actionPending = false;
        say(payload.message || "That move could not be completed.");
        render();
      }
    } catch {
      say("The room sent an unreadable update.");
    }
  });

  socket.addEventListener("close", (event) => {
    connected = false;
    actionPending = false;
    render();
    if (leaving) return;
    if (event.code === 4000) {
      say("This room has expired.");
      return;
    }
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
  });

  socket.addEventListener("error", () => {
    connected = false;
    render();
  });
}

function render() {
  if (!state) {
    renderEmptyTable();
    say(connected ? "Waiting for the room…" : "Connecting to the room…");
    return;
  }

  const before = snapshotCards();
  renderHands();
  renderCenter();
  renderDock();
  renderHistory();
  animateCards(before);
  syncCountUp();
}

function renderEmptyTable() {
  els.aiHand.innerHTML = "";
  els.playerHand.innerHTML = "";
  els.held.innerHTML = "";
  els.discard.innerHTML = '<span class="pile-label">discard</span>';
  els.deckStack.innerHTML = "";
  els.deckCount.textContent = "deck";
  els.actions.innerHTML = "";
  els.deck.disabled = true;
  els.discard.classList.add("empty");
  els.discard.setAttribute("aria-disabled", "true");
}

function renderHands() {
  const you = player(state.youId);
  const opponent = otherPlayer();
  els.playerHand.setAttribute("aria-label", `${you?.name || "Your"} cards`);
  els.aiHand.setAttribute("aria-label", `${opponent?.name || "Opponent"} cards`);
  renderHand(els.playerHand, you?.hand || [], "player");
  renderHand(els.aiHand, opponent?.hand || [], "opponent");
}

function renderHand(container, hand, owner) {
  container.innerHTML = "";
  hand.forEach((card, index) => {
    if (!card) {
      container.appendChild(emptySlot());
      return;
    }
    const selectable = canSelectCard(owner);
    const cardButton = cardElement(card, { faceUp: !card.hidden, index, owner, selectable });
    cardButton.dataset.deal = String(index * 2 + (owner === "opponent" ? 1 : 0));
    if (owner === "player" && state.selectedOwn === index) cardButton.classList.add("selected");
    if (owner === "opponent" && state.selectedOpponent === index) cardButton.classList.add("selected");
    cardButton.addEventListener("click", () => handleCardClick(owner, index));
    container.appendChild(cardButton);
  });
}

// The spot a discarded card left behind: it holds the grid open so nothing shifts.
function emptySlot() {
  const slot = document.createElement("span");
  slot.className = "card-slot";
  slot.setAttribute("aria-hidden", "true");
  return slot;
}

function renderCenter() {
  const layers = Math.min(6, Math.ceil(state.deckCount / 9));
  if (els.deckStack.childElementCount !== layers) {
    els.deckStack.innerHTML = "";
    for (let i = 0; i < layers; i += 1) {
      const layer = document.createElement("span");
      layer.className = "deck-layer";
      layer.style.setProperty("--i", String(i));
      els.deckStack.appendChild(layer);
    }
  }
  els.deckCount.textContent = `deck · ${state.deckCount}`;

  els.held.innerHTML = "";
  if (state.drawn) els.held.appendChild(cardElement(state.drawn, { faceUp: !state.drawn.hidden }));

  els.discard.innerHTML = "";
  state.discard.forEach((card, index) => {
    const cardButton = cardElement(card, { faceUp: true });
    cardButton.style.rotate = `${tilt(card)}deg`;
    if (index < state.discard.length - 1) cardButton.dataset.under = "true";
    else cardButton.dataset.deal = "99";
    els.discard.appendChild(cardButton);
  });
  els.discard.classList.toggle("empty", state.discard.length === 0);
  const label = document.createElement("span");
  label.className = "pile-label";
  label.textContent = "discard";
  els.discard.appendChild(label);
}

function renderDock() {
  const yourTurn = state.currentPlayerId === state.youId && state.status === "playing";
  const opponent = otherPlayer();
  const opponentConnected = !opponent || connectedPlayerIds.includes(opponent.id);
  const interactive = connected && opponentConnected && !actionPending;

  els.turnLabel.textContent = turnLabel();
  els.turnLabel.classList.toggle("active", yourTurn);

  const canDraw = interactive && yourTurn && state.phase === "await-draw";
  els.deck.disabled = !canDraw;
  els.deck.classList.toggle("ready", canDraw);
  els.discard.classList.toggle("ready", canDraw && state.discard.length > 0);
  els.discard.setAttribute("aria-disabled", String(!(canDraw && state.discard.length > 0)));

  els.actions.innerHTML = "";
  for (const [label, action, primary] of availableActions()) {
    const local = typeof action === "function";
    const button = actionButton(label, primary ? "primary-button" : "secondary-button", local ? action : () => sendAction(action));
    button.disabled = local ? false : !interactive;
    els.actions.appendChild(button);
  }
  say(statusMessage());
}

function turnLabel() {
  if (state.status === "waiting") return "waiting for a friend";
  if (state.status === "peeking") return "opening peek";
  if (state.status === "finished") return counting ? "counting up" : "round over";
  if (state.currentPlayerId === state.youId) return state.caboCallerId ? "your final turn" : "your turn";
  return `${otherPlayer()?.name || "opponent"}’s turn`;
}

function statusMessage() {
  if (!connected) return "Reconnecting…";
  const opponent = otherPlayer();
  if (opponent && !connectedPlayerIds.includes(opponent.id)) return `${opponent.name} disconnected. Waiting for them to return…`;
  if (state.status === "waiting") return "Share the invite link with one other player.";
  if (state.status === "peeking") {
    return state.initialReady[state.youId]
      ? `Waiting for ${opponent?.name || "the other player"}…`
      : "Memorize your bottom two cards, then press got it.";
  }
  if (state.status === "finished") {
    if (counting) return "Hands are down. Counting them up…";
    const you = player(state.youId);
    const summary = `You ${state.scores?.[state.youId] ?? 0}, ${opponent?.name || "opponent"} ${state.scores?.[opponent?.id] ?? 0}.`;
    if (you?.rematchReady) return `${summary} Waiting for ${opponent?.name || "the other player"} to play again…`;
    if (opponent?.rematchReady) return `${summary} ${opponent.name} is ready to play again.`;
    return `${summary} ${player(state.caboCallerId)?.name || "Someone"} called cabo.`;
  }
  if (state.currentPlayerId !== state.youId) return `${opponent?.name || "Your opponent"} is taking their turn.`;

  switch (state.phase) {
    case "await-draw": return "Draw from the deck or the discard.";
    case "drawn": return `You drew ${prettyCard(state.drawn)}. Choose one of your cards to swap it in, or discard it.`;
    case "choose-replace": return `You took ${prettyCard(state.drawn)}. Choose one of your cards to swap it in.`;
    case "match-mode": return "Choose the face-down card you think matches the top discard.";
    case "power-peek-own": return "Choose one of your cards to peek at.";
    case "power-peek-opponent": return "Choose one opponent card to peek at.";
    case "power-j-own": return "Choose one of your cards for a blind swap.";
    case "power-j-opponent": return "Now choose one opponent card. You won't see either first.";
    case "power-q-own": return "Choose one of your cards to swap.";
    case "power-q-opponent": return "Choose one opponent card to swap with.";
    case "power-k-check-opponent": return "Choose one opponent card to check first.";
    case "power-k-own": return `That's ${revealedCardName()}. Now choose one of yours.`;
    case "king-swap-choice": return "Swap your selected card with the card you checked?";
    case "power-confirm": return `Remember ${revealedCardName()}.`;
    default: return "Your turn.";
  }
}

function availableActions() {
  if (counting) return [["skip", skipCountUp]];
  const legal = new Set(state.legalActions);
  if (legal.has("READY")) return [["got it", { type: "READY" }, true]];
  if (legal.has("REMATCH")) return [["play again", { type: "REMATCH" }, true]];
  if (state.phase === "await-draw") {
    const actions = [];
    if (legal.has("MATCH_START")) actions.push(["match discard", { type: "MATCH_START" }]);
    if (legal.has("CALL_CABO")) actions.push(["call cabo", { type: "CALL_CABO" }, true]);
    return actions;
  }
  if (state.phase === "drawn" && legal.has("DISCARD_DRAWN")) {
    const power = POWER_LABELS[powerFor(state.drawn)];
    return [[power ? `discard · ${power}` : "discard", { type: "DISCARD_DRAWN" }]];
  }
  if (legal.has("MATCH_CANCEL")) return [["cancel", { type: "MATCH_CANCEL" }]];
  if (legal.has("CONFIRM_PEEK")) return [["got it", { type: "CONFIRM_PEEK" }, true]];
  if (legal.has("KING_SWAP")) {
    return [
      ["keep hands", { type: "KING_KEEP" }],
      ["swap", { type: "KING_SWAP" }, true],
    ];
  }
  if (legal.has("SKIP_POWER")) return [["skip", { type: "SKIP_POWER" }]];
  return [];
}

function canSelectCard(owner) {
  if (!connected || actionPending || state.currentPlayerId !== state.youId || state.status !== "playing") return false;
  const legal = new Set(state.legalActions);
  if (owner === "player") return legal.has("REPLACE") || legal.has("MATCH") || legal.has("SELECT_OWN");
  return legal.has("SELECT_OPPONENT");
}

function handleCardClick(owner, index) {
  const legal = new Set(state.legalActions);
  if (owner === "player") {
    if (legal.has("REPLACE")) return sendAction({ type: "REPLACE", index });
    if (legal.has("MATCH")) return sendAction({ type: "MATCH", index });
    if (legal.has("SELECT_OWN")) return sendAction({ type: "SELECT_OWN", index });
  } else if (legal.has("SELECT_OPPONENT")) {
    return sendAction({ type: "SELECT_OPPONENT", index });
  }
}

function sendAction(action) {
  if (!connected || actionPending || socket?.readyState !== WebSocket.OPEN) return;
  actionPending = true;
  socket.send(JSON.stringify({ type: "action", action }));
  renderDock();
}

function renderHistory() {
  const names = Object.fromEntries(state.players.map((candidate) => [candidate.id, candidate.name]));
  for (const list of [els.historyList, els.historyListModal]) {
    list.innerHTML = "";
    for (const entry of state.history.slice(-8).reverse()) {
      const item = document.createElement("li");
      item.className = "history-group";
      const who = document.createElement("span");
      who.className = "history-who";
      who.textContent = entry.actorId === "round" ? "round" : names[entry.actorId] || "player";
      const line = document.createElement("span");
      line.className = "history-line";
      line.textContent = entry.text;
      item.append(who, line);
      list.appendChild(item);
    }
  }
}

// The round ends on the table rather than behind a dialog: every card turns over where it
// lies, then each hand is counted one card at a time with the total ticking up beside it.
function syncCountUp() {
  if (state.status !== "finished") {
    if (countedRound !== null) clearCountUp();
    return;
  }
  if (countedRound === state.roundNumber) {
    repaintCountUp(); // a fresh render rebuilt the cards; put the progress back on them
    return;
  }
  countedRound = state.roundNumber;
  runCountUp((countToken += 1));
}

async function runCountUp(token) {
  counting = true;
  countProgress = { player: 0, opponent: 0, active: null };
  els.resultLine.hidden = true;
  showTally(els.playerTally, player(state.youId)?.name || "you");
  showTally(els.aiTally, otherPlayer()?.name || "opponent");
  renderDock();

  const complete = await runScoreCount({
    hands: [
      { side: "player", cards: handFor("player"), container: els.playerHand, tally: els.playerTally },
      { side: "opponent", cards: handFor("opponent"), container: els.aiHand, tally: els.aiTally },
    ],
    shouldContinue: () => token === countToken,
    onHandStart: ({ side, container, tally }) => {
      countProgress.active = side;
      container.classList.add("tallying");
      tally.classList.add("active");
    },
    onCard: ({ side, container, tally }, card, index) => {
      const value = valueOf(card);
      const running = (Number(tally.querySelector(".tally-total").textContent) || 0) + value;
      revealScoreCard(container.children[index], value);
      countProgress[side] = index + 1;
      setTally(tally, running);
    },
    onHandEnd: ({ container, tally }) => {
      countProgress.active = null;
      container.classList.remove("tallying");
      tally.classList.remove("active");
    },
  });
  if (complete && token === countToken) settleCountUp();
}

// Both totals land, the winner is marked, and the table stays exactly as it is.
function settleCountUp() {
  counting = false;
  const opponent = otherPlayer();
  const yourScore = state.scores?.[state.youId] ?? 0;
  const opponentScore = opponent ? state.scores?.[opponent.id] ?? 0 : 0;
  const winners = state.winnerIds || [];

  countProgress = {
    player: (player(state.youId)?.hand || []).length,
    opponent: (opponent?.hand || []).length,
    active: null,
  };
  repaintCountUp();
  for (const [tally, total] of [[els.playerTally, yourScore], [els.aiTally, opponentScore]]) {
    tally.classList.remove("active");
    setTally(tally, total);
  }
  els.playerTally.classList.toggle("winner", winners.length === 1 && winners.includes(state.youId));
  els.aiTally.classList.toggle("winner", winners.length === 1 && Boolean(opponent) && winners.includes(opponent.id));

  els.resultLine.textContent = winners.length > 1
    ? "tie game"
    : winners.includes(state.youId)
      ? "you win"
      : `${opponent?.name || "opponent"} wins`;
  els.resultLine.hidden = false;
  renderDock();
}

function skipCountUp() {
  countToken += 1; // stops the run in flight
  settleCountUp();
}

function repaintCountUp() {
  for (const [side, container] of [["player", els.playerHand], ["opponent", els.aiHand]]) {
    const hand = handFor(side);
    container.classList.toggle("tallying", countProgress.active === side);
    [...container.children].forEach((card, index) => {
      const counted = index < countProgress[side];
      card.classList.toggle("counted", counted);
      const badge = card.querySelector(".card-value");
      if (counted && hand[index] && !badge) card.appendChild(scoreValueBadge(valueOf(hand[index])));
      else if (!counted && badge) badge.remove();
    });
  }
}

function clearCountUp() {
  countToken += 1;
  countedRound = null;
  counting = false;
  countProgress = { player: 0, opponent: 0, active: null };
  els.resultLine.hidden = true;
  els.resultLine.textContent = "";
  for (const tally of [els.playerTally, els.aiTally]) {
    tally.hidden = true;
    tally.classList.remove("active", "winner");
  }
  for (const container of [els.playerHand, els.aiHand]) container.classList.remove("tallying");
}

function showTally(tally, name) {
  tally.querySelector(".tally-name").textContent = name;
  tally.querySelector(".tally-total").textContent = "0";
  tally.classList.remove("active", "winner");
  tally.hidden = false;
}

function setTally(tally, value) {
  setTallyValue(tally, value);
}

function handFor(side) {
  return (side === "player" ? player(state.youId)?.hand : otherPlayer()?.hand) || [];
}

function valueOf(card) {
  return card?.rank ? scoreCard(card) : 0;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function revealedCardName() {
  for (const candidate of state.players) {
    const revealed = candidate.hand.find((card) => card && !card.hidden);
    if (revealed) return prettyCard(revealed);
  }
  return "that card";
}

function player(id) {
  return state?.players.find((candidate) => candidate.id === id) || null;
}

function otherPlayer() {
  return state?.players.find((candidate) => candidate.id !== state.youId) || null;
}

function actionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function cardElement(card, { faceUp = false, index = null, owner = null, selectable = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card ${faceUp ? "face-up" : "face-down"}`;
  button.disabled = !selectable;
  button.dataset.cardId = card.id;
  button.setAttribute("aria-label", faceUp ? prettyCard(card) : "face-down card");
  if (selectable) button.classList.add("selectable");
  if (index !== null) button.dataset.index = String(index);
  if (owner) button.dataset.owner = owner;

  const red = card.suit === "♥" || card.suit === "♦";
  const label = card.rank === "JOKER" ? "★" : card.rank || "";
  const suit = card.rank === "JOKER" ? "" : card.suit || "";
  button.innerHTML = `
    <span class="card-inner">
      <span class="card-face card-back"></span>
      <span class="card-face card-front${red ? " red" : ""}" aria-hidden="true">
        <span class="card-corner"><span>${label}</span><span class="card-suit">${suit}</span></span>
        <span class="card-center">${card.rank === "JOKER" ? "★" : suit}</span>
        <span class="card-corner bottom"><span>${label}</span><span class="card-suit">${suit}</span></span>
      </span>
    </span>`;
  return button;
}

function tilt(card) {
  let hash = 0;
  for (const character of card.id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return (Math.abs(hash) % 9) - 4;
}

function leaveGame() {
  leaving = true;
  clearTimeout(reconnectTimer);
  if (socket) socket.close(1000, "Left game");
  location.assign(gameUrl("cabo"));
}

function openSettings() {
  for (const radio of els.themeRadios) radio.checked = radio.value === themeSetting();
  els.settingsDialog.showModal();
}

function themeSetting() {
  return document.documentElement.dataset.theme || "system";
}

function applyTheme(value) {
  if (value === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  try {
    if (value === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", value);
  } catch {}
  updateThemeColor();
}

function updateThemeColor() {
  const setting = themeSetting();
  const dark = setting === "dark" || (setting === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  els.themeColor.content = dark ? "#161614" : "#f4f0e7";
}

function say(text) {
  els.message.textContent = text;
}
