import { prettyCard, powerFor } from "../shared/games/cabo.js";
import { loadCredential, multiplayerApiBase, roomUrl } from "./config.js";
import { closeLobby, setupLobby, showWaitingRoom } from "./lobby.js";

const MOVE_MS = 460;
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
  resultDialog: document.getElementById("resultDialog"),
  resultTitle: document.getElementById("resultTitle"),
  resultEyebrow: document.getElementById("resultEyebrow"),
  playerScore: document.getElementById("playerScore"),
  aiScore: document.getElementById("aiScore"),
  opponentScoreLabel: document.getElementById("opponentScoreLabel"),
  playAgainBtn: document.getElementById("playAgainBtn"),
  resultSettingsBtn: document.getElementById("resultSettingsBtn"),
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
let shownResultRound = null;

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
  els.resultSettingsBtn.addEventListener("click", openSettings);
  els.playAgainBtn.addEventListener("click", () => {
    els.resultDialog.close();
    sendAction({ type: "REMATCH" });
  });

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
  maybeShowResult();
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
    const selectable = canSelectCard(owner);
    const cardButton = cardElement(card, { faceUp: !card.hidden, index, owner, selectable });
    cardButton.dataset.deal = String(index * 2 + (owner === "opponent" ? 1 : 0));
    if (owner === "player" && state.selectedOwn === index) cardButton.classList.add("selected");
    if (owner === "opponent" && state.selectedOpponent === index) cardButton.classList.add("selected");
    cardButton.addEventListener("click", () => handleCardClick(owner, index));
    container.appendChild(cardButton);
  });
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

  els.actions.innerHTML = "";
  for (const [label, action, primary] of availableActions()) {
    const button = actionButton(label, primary ? "primary-button" : "secondary-button", () => sendAction(action));
    button.disabled = !interactive;
    els.actions.appendChild(button);
  }
  say(statusMessage());
}

function turnLabel() {
  if (state.status === "waiting") return "waiting for a friend";
  if (state.status === "peeking") return "opening peek";
  if (state.status === "finished") return "round over";
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
    const you = player(state.youId);
    if (you?.rematchReady) return `Waiting for ${opponent?.name || "the other player"} to play again…`;
    if (opponent?.rematchReady) return `${opponent.name} is ready to play again.`;
    return "Round over.";
  }
  if (state.currentPlayerId !== state.youId) return `${opponent?.name || "Your opponent"} is taking their turn.`;

  switch (state.phase) {
    case "await-draw": return "Tap the deck or the discard to draw.";
    case "drawn": return `You drew ${prettyCard(state.drawn)}. Tap one of your cards to swap it in, or discard it.`;
    case "choose-replace": return `You took ${prettyCard(state.drawn)}. Tap one of your cards to swap it in.`;
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

function maybeShowResult() {
  if (state.status !== "finished" || shownResultRound === state.roundNumber) return;
  shownResultRound = state.roundNumber;
  const you = player(state.youId);
  const opponent = otherPlayer();
  const yourScore = state.scores[state.youId];
  const opponentScore = state.scores[opponent.id];
  els.playerScore.textContent = String(yourScore);
  els.aiScore.textContent = String(opponentScore);
  els.opponentScoreLabel.textContent = opponent.name;
  els.resultEyebrow.textContent = `${player(state.caboCallerId)?.name || "player"} called cabo`;
  els.resultTitle.textContent = yourScore < opponentScore ? "you win" : yourScore > opponentScore ? `${opponent.name} wins` : "tie game";
  setTimeout(() => {
    if (state?.status === "finished" && !els.resultDialog.open) els.resultDialog.showModal();
  }, 700);
}

function revealedCardName() {
  for (const candidate of state.players) {
    const revealed = candidate.hand.find((card) => !card.hidden);
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

function snapshotCards() {
  const snapshot = new Map();
  for (const element of document.querySelectorAll(".card[data-card-id]")) {
    snapshot.set(element.dataset.cardId, {
      rect: element.getBoundingClientRect(),
      width: element.offsetWidth,
      faceUp: element.classList.contains("face-up"),
    });
  }
  return snapshot;
}

function animateCards(before) {
  if (reduceMotion.matches) return;
  const deckRect = (els.deckStack.lastElementChild || els.deck).getBoundingClientRect();
  const fromDeck = { rect: deckRect, width: deckRect.width, faceUp: false };
  const dealt = [];
  for (const element of document.querySelectorAll(".card[data-card-id]")) {
    const previous = before.get(element.dataset.cardId);
    if (previous) animateCard(element, previous, 0);
    else if (!element.dataset.under) dealt.push(element);
  }
  dealt
    .sort((a, b) => Number(a.dataset.deal || 0) - Number(b.dataset.deal || 0))
    .forEach((element, index) => animateCard(element, fromDeck, index * 90));
}

function animateCard(element, from, delay) {
  const to = element.getBoundingClientRect();
  const dx = from.rect.left + from.rect.width / 2 - (to.left + to.width / 2);
  const dy = from.rect.top + from.rect.height / 2 - (to.top + to.height / 2);
  const scale = from.width / element.offsetWidth;
  const timing = { duration: MOVE_MS, delay, easing: "cubic-bezier(.2, .75, .25, 1)", fill: "backwards" };
  if (Math.abs(dx) + Math.abs(dy) > 1 || Math.abs(scale - 1) > 0.01) {
    element.style.zIndex = "10";
    const lift = ((scale + 1) / 2) * 1.06;
    element.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
        { transform: `translate(${dx / 2}px, ${dy / 2}px) scale(${lift})`, offset: 0.5 },
        { transform: "translate(0, 0) scale(1)" },
      ],
      { ...timing, composite: "add" },
    ).finished.then(() => { element.style.zIndex = ""; }, () => {});
  }
  const faceUp = element.classList.contains("face-up");
  if (faceUp !== from.faceUp) {
    element.querySelector(".card-inner").animate(
      [{ transform: `rotateY(${from.faceUp ? 180 : 0}deg)` }, { transform: `rotateY(${faceUp ? 180 : 0}deg)` }],
      timing,
    );
  }
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
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  location.assign(url);
}

function openSettings() {
  if (els.resultDialog.open) els.resultDialog.close();
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
