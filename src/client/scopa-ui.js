import { captureOptions, cardValue, prettyCard } from "../shared/games/scopa.js";
import { animateCards, snapshotCards } from "./card-motion.js";

const baseEls = {
  table: document.querySelector(".table"),
  turnLabel: document.getElementById("turnLabel"),
  message: document.getElementById("message"),
  actions: document.getElementById("actions"),
  historyList: document.getElementById("historyList"),
  historyListModal: document.getElementById("historyListModal"),
  historyBtn: document.getElementById("historyBtn"),
  historyDialog: document.getElementById("historyDialog"),
  closeHistoryBtn: document.getElementById("closeHistoryBtn"),
  rulesBtn: document.getElementById("rulesBtn"),
  rulesDialog: document.getElementById("rulesDialog"),
  closeRulesBtn: document.getElementById("closeRulesBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsDialog: document.getElementById("settingsDialog"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  computerSetting: document.getElementById("computerSetting"),
  levelRadios: document.querySelectorAll('input[name="level"]'),
  levelPending: document.getElementById("levelPending"),
  levelPendingText: document.getElementById("levelPendingText"),
  newGameNowBtn: document.getElementById("newGameNowBtn"),
  themeRadios: document.querySelectorAll('input[name="theme"]'),
  themeColor: document.querySelector('meta[name="theme-color"]'),
  resultLine: document.getElementById("resultLine"),
  newGameBtn: document.getElementById("newGameBtn"),
};

export function createScopaTable({
  dispatch,
  onNewGame = null,
  online = false,
  getComputerLevel = null,
  getActiveComputerLevel = null,
  onComputerLevelChange = null,
}) {
  const els = { ...baseEls, ...buildTable() };
  let state = null;
  let meta = { connected: true, busy: false, connectedPlayerIds: [] };
  let selectedHandIndex = null;
  let previewCaptureIds = [];
  let previousScopas = null;
  let sweepTimer = null;

  const canChangeComputerLevel = !online && typeof getComputerLevel === "function" && typeof onComputerLevelChange === "function";
  els.computerSetting.hidden = !canChangeComputerLevel;
  els.rulesBtn.addEventListener("click", () => els.rulesDialog.showModal());
  els.closeRulesBtn.addEventListener("click", () => els.rulesDialog.close());
  els.historyBtn.addEventListener("click", () => els.historyDialog.showModal());
  els.closeHistoryBtn.addEventListener("click", () => els.historyDialog.close());
  els.settingsBtn.addEventListener("click", openSettings);
  els.closeSettingsBtn.addEventListener("click", () => els.settingsDialog.close());

  if (onNewGame) els.newGameBtn.addEventListener("click", onNewGame);
  else els.newGameBtn.hidden = true;

  if (canChangeComputerLevel) {
    for (const radio of els.levelRadios) {
      radio.addEventListener("change", () => {
        onComputerLevelChange(radio.value);
        updateComputerLevelNote();
      });
    }
    els.newGameNowBtn.addEventListener("click", () => {
      els.settingsDialog.close();
      onNewGame?.();
    });
  }

  for (const radio of els.themeRadios) radio.addEventListener("change", () => applyTheme(radio.value));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateThemeColor);
  updateThemeColor();

  function act(type, extra = {}) {
    if (!state?.legalActions.includes(type) || meta.busy || !isInteractive(state, meta, online)) return;
    selectedHandIndex = null;
    previewCaptureIds = [];
    dispatch({ type, ...extra });
  }

  function selectHand(index) {
    if (!canPlay()) return;
    selectedHandIndex = selectedHandIndex === index ? null : index;
    previewCaptureIds = [];
    paint();
  }

  function canPlay() {
    return Boolean(
      state?.legalActions.includes("PLAY_CARD")
      && !meta.busy
      && isInteractive(state, meta, online),
    );
  }

  function openSettings() {
    if (canChangeComputerLevel) updateComputerLevelNote();
    for (const radio of els.themeRadios) radio.checked = radio.value === themeSetting();
    els.settingsDialog.showModal();
  }

  function updateComputerLevelNote() {
    const selected = getComputerLevel?.() || "easy";
    const active = getActiveComputerLevel?.() || selected;
    for (const radio of els.levelRadios) radio.checked = radio.value === selected;
    const matchOver = state?.status === "match-finished";
    els.levelPending.hidden = selected === active || matchOver;
    els.levelPendingText.textContent = `This match stays on ${active}.`;
  }

  function render(nextState, nextMeta = {}) {
    const oldRevision = state?.revision;
    const oldScopas = previousScopas;
    state = nextState;
    meta = { ...meta, message: "", ...nextMeta };
    if (!state) return renderEmpty(meta.message || "Loading Scopa…");
    if (oldRevision !== state.revision) {
      selectedHandIndex = null;
      previewCaptureIds = [];
    }
    previousScopas = Object.fromEntries(state.players.map((player) => [player.id, player.scopas]));
    paint();
    if (oldScopas) {
      const sweeper = state.players.find((player) => player.scopas > (oldScopas[player.id] || 0));
      if (sweeper) pulseSweep(sweeper.id);
    }
  }

  function paint() {
    if (!state) return;
    const before = snapshotCards(els.table);
    renderHands();
    renderBoard();
    renderDock();
    renderHistory();
    renderScores();
    animateCards(before, { root: els.table, deck: els.deck });
  }

  function renderEmpty(message = "Loading Scopa…") {
    state = null;
    selectedHandIndex = null;
    previewCaptureIds = [];
    els.aiHand.innerHTML = "";
    els.playerHand.innerHTML = "";
    els.scopaTable.innerHTML = "";
    els.deckStack.innerHTML = "";
    els.deckCount.textContent = "deck";
    renderCapturePile(els.opponentCapture, [], "opponent", 0);
    renderCapturePile(els.playerCapture, [], "you", 0);
    els.actions.innerHTML = "";
    els.playerTally.hidden = true;
    els.aiTally.hidden = true;
    els.resultLine.hidden = true;
    els.turnLabel.textContent = "scopa";
    els.message.textContent = message;
  }

  function renderHands() {
    const you = player(state, state.youId);
    const opponent = otherPlayer(state);
    renderHand(els.playerHand, you?.hand || [], "player", you?.name || "Your");
    renderHand(els.aiHand, opponent?.hand || [], "opponent", opponent?.name || "Opponent");
  }

  function renderHand(container, hand, owner, name) {
    const selectable = owner === "player" && canPlay();
    container.setAttribute("aria-label", `${name} cards`);
    container.innerHTML = "";
    hand.forEach((card, index) => {
      const button = cardElement(card, {
        faceUp: !card.hidden,
        owner,
        index,
        selectable,
      });
      button.dataset.deal = String(index * 2 + (owner === "opponent" ? 1 : 0));
      if (owner === "player" && selectedHandIndex === index) button.classList.add("selected");
      if (selectable) button.addEventListener("click", () => selectHand(index));
      container.appendChild(button);
    });
  }

  function renderBoard() {
    renderDeck();
    const you = player(state, state.youId);
    const opponent = otherPlayer(state);
    renderCapturePile(els.opponentCapture, opponent?.captured || [], opponent?.name || "opponent", opponent?.scopas || 0);
    renderCapturePile(els.playerCapture, you?.captured || [], you?.name || "you", you?.scopas || 0);

    if (roundIsOver()) renderRoundScore();
    else renderTableCards();
  }

  function renderDeck() {
    const layers = Math.min(6, Math.ceil(state.deckCount / 6));
    els.deckStack.innerHTML = "";
    for (let index = 0; index < layers; index += 1) {
      const layer = document.createElement("span");
      layer.className = "deck-layer";
      layer.style.setProperty("--i", String(index));
      els.deckStack.appendChild(layer);
    }
    els.deckCount.textContent = `deck · ${state.deckCount}`;
  }

  function renderTableCards() {
    const selected = selectedCard();
    const options = selected ? captureOptions(state.table, selected) : [];
    const possible = new Set(options.flat());
    const preview = new Set(previewCaptureIds.length ? previewCaptureIds : options.length === 1 ? options[0] : []);
    els.scopaTable.className = "scopa-table";
    els.scopaTable.setAttribute("aria-label", `${state.table.length} cards on the table`);
    els.scopaTable.innerHTML = "";
    state.table.forEach((card, index) => {
      const button = cardElement(card, { faceUp: true });
      button.dataset.deal = String(20 + index);
      if (possible.has(card.id)) button.classList.add("capturable");
      if (preview.has(card.id)) button.classList.add("capture-preview");
      els.scopaTable.appendChild(button);
    });
    if (!state.table.length) {
      const empty = document.createElement("span");
      empty.className = "scopa-empty-table";
      empty.textContent = "scopa";
      els.scopaTable.appendChild(empty);
    }
  }

  function renderRoundScore() {
    const you = player(state, state.youId);
    const opponent = otherPlayer(state);
    const breakdown = state.roundBreakdown;
    els.scopaTable.className = "scopa-table scopa-round-score";
    els.scopaTable.setAttribute("aria-label", "Round score");
    els.scopaTable.innerHTML = "";
    if (!breakdown || !you || !opponent) return;

    const header = document.createElement("div");
    header.className = "scopa-score-row scopa-score-header";
    header.innerHTML = `<span></span><span>${escapeHtml(opponent.name)}</span><span>${escapeHtml(you.name)}</span>`;
    els.scopaTable.appendChild(header);

    const rows = [
      ["scope", "scopas", (value) => String(value)],
      ["cards", "cards", (value) => String(value)],
      ["diamonds", "diamonds", (value) => String(value)],
      ["7♦", "settebello", (value) => value ? "yes" : "—"],
      ["primiera", "primiera", (value) => value ?? "—"],
    ];
    for (const [label, key, format] of rows) {
      const row = document.createElement("div");
      row.className = `scopa-score-row scopa-score-${key}`;
      const opponentWon = key === "scopas" ? breakdown.scopas[opponent.id] > 0 : breakdown.awards[key] === opponent.id;
      const youWon = key === "scopas" ? breakdown.scopas[you.id] > 0 : breakdown.awards[key] === you.id;
      row.innerHTML = `
        <span>${label}</span>
        <strong${opponentWon ? ' class="won"' : ""}>${format(breakdown[key][opponent.id])}</strong>
        <strong${youWon ? ' class="won"' : ""}>${format(breakdown[key][you.id])}</strong>`;
      els.scopaTable.appendChild(row);
    }
  }

  function renderDock() {
    const interactive = isInteractive(state, meta, online) && !meta.busy;
    els.turnLabel.textContent = turnLabel(state, meta.computerLevel);
    els.turnLabel.classList.toggle("active", state.currentPlayerId === state.youId && state.status === "playing");
    els.message.textContent = statusMessage();
    els.resultLine.hidden = !roundIsOver();
    els.resultLine.textContent = roundIsOver() ? roundResultText() : "";
    els.actions.innerHTML = "";

    if (state.legalActions.includes("PLAY_CARD") && selectedHandIndex !== null) {
      const card = selectedCard();
      const options = captureOptions(state.table, card);
      const moves = options.length ? options : [[]];
      for (const captureIds of moves) {
        const captured = state.table.filter((candidate) => captureIds.includes(candidate.id));
        const label = captured.length
          ? `take ${captured.map(prettyCard).join(" + ")}`
          : `play ${prettyCard(card)}`;
        const button = actionButton(label, moves.length === 1 ? "primary-button" : "secondary-button", () => {
          act("PLAY_CARD", { handIndex: selectedHandIndex, captureIds });
        });
        if (moves.length > 1) button.classList.add("scopa-capture-choice");
        if (moves.length === 1) button.id = "scopaMove";
        button.disabled = !interactive;
        button.addEventListener("pointerenter", () => previewCapture(captureIds));
        button.addEventListener("pointerleave", clearCapturePreview);
        button.addEventListener("focus", () => previewCapture(captureIds));
        button.addEventListener("blur", clearCapturePreview);
        els.actions.appendChild(button);
      }
    }

    if (state.legalActions.includes("READY_NEXT")) {
      const button = actionButton("next round", "primary-button", () => act("READY_NEXT"));
      button.disabled = !interactive;
      els.actions.appendChild(button);
    }
    if (state.legalActions.includes("REMATCH")) {
      const button = actionButton("play again", "primary-button", () => act("REMATCH"));
      button.disabled = !interactive;
      els.actions.appendChild(button);
    }
  }

  function previewCapture(captureIds) {
    if (!captureIds.length) return;
    previewCaptureIds = captureIds;
    renderTableCards();
  }

  function clearCapturePreview() {
    if (!previewCaptureIds.length) return;
    previewCaptureIds = [];
    renderTableCards();
  }

  function selectedCard() {
    return selectedHandIndex === null ? null : player(state, state.youId)?.hand[selectedHandIndex] || null;
  }

  function statusMessage() {
    if (meta.message) return meta.message;
    if (online && !meta.connected) return "Reconnecting…";
    const you = player(state, state.youId);
    const opponent = otherPlayer(state);
    if (online && opponent && !meta.connectedPlayerIds.includes(opponent.id)) return `${opponent.name} disconnected. Waiting for them to return…`;
    if (state.status === "waiting") return "Share the invite link with one other player.";
    if (roundIsOver()) {
      const yourPoints = state.roundScores?.[you?.id] || 0;
      const theirPoints = state.roundScores?.[opponent?.id] || 0;
      if (you?.ready) return `You scored ${yourPoints}; ${opponent?.name || "opponent"} scored ${theirPoints}. Waiting for them…`;
      return `This round: you +${yourPoints}, ${opponent?.name || "opponent"} +${theirPoints}. First to 11 wins.`;
    }
    if (state.currentPlayerId !== state.youId) return `${opponent?.name || "Your opponent"} is choosing a card.`;
    const card = selectedCard();
    if (!card) return "Choose one card to play.";
    const options = captureOptions(state.table, card);
    if (!options.length) return `${prettyCard(card)} cannot capture. Play it to the table.`;
    if (options.length === 1) return options[0].length === 1 ? "Take the highlighted card." : "Take the highlighted cards.";
    return "Choose which cards to take.";
  }

  function renderHistory() {
    const names = Object.fromEntries(state.players.map((candidate) => [candidate.id, candidate.name]));
    for (const list of [els.historyList, els.historyListModal]) {
      list.innerHTML = "";
      for (const entry of state.history.slice(-10).reverse()) {
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

  function renderScores() {
    const you = player(state, state.youId);
    const opponent = otherPlayer(state);
    setTally(els.playerTally, you?.name || "you", state.scores?.[you?.id] || 0);
    setTally(els.aiTally, opponent?.name || "opponent", state.scores?.[opponent?.id] || 0);
    const matchWinner = state.matchWinnerIds[0];
    els.playerTally.classList.toggle("winner", matchWinner === you?.id);
    els.aiTally.classList.toggle("winner", matchWinner === opponent?.id);
  }

  function roundResultText() {
    const winners = state.status === "match-finished" ? state.matchWinnerIds : state.roundWinnerIds;
    if (winners.length !== 1) return state.status === "match-finished" ? "tie match" : "round tied";
    const winner = player(state, winners[0]);
    const youWon = winner?.id === state.youId;
    if (state.status === "match-finished") return youWon ? "you win the match" : `${winner?.name || "opponent"} wins the match`;
    return youWon ? "you win the round" : `${winner?.name || "opponent"} wins the round`;
  }

  function pulseSweep(playerId) {
    clearTimeout(sweepTimer);
    els.board.classList.remove("scopa-sweep");
    els.opponentCapture.classList.remove("scopa-capture-pop");
    els.playerCapture.classList.remove("scopa-capture-pop");
    void els.board.offsetWidth;
    els.board.classList.add("scopa-sweep");
    const pile = playerId === state.youId ? els.playerCapture : els.opponentCapture;
    pile.classList.add("scopa-capture-pop");
    sweepTimer = setTimeout(() => {
      els.board.classList.remove("scopa-sweep");
      pile.classList.remove("scopa-capture-pop");
    }, 900);
  }

  function roundIsOver() {
    return state?.status === "round-finished" || state?.status === "match-finished";
  }

  renderEmpty();
  return { render, renderEmpty };
}

function buildTable() {
  baseEls.table.classList.add("scopa-game-table");
  baseEls.table.innerHTML = `
    <div class="hand-row">
      <div id="aiHand" class="hand ai-hand" aria-label="Opponent cards"></div>
      <div id="aiTally" class="tally" hidden>
        <span class="tally-name">opponent</span>
        <span class="tally-total">0</span>
      </div>
    </div>
    <div id="scopaBoard" class="scopa-board">
      <button id="deck" class="deck scopa-deck" type="button" aria-label="Scopa deck" disabled>
        <span id="deckStack" class="deck-stack"></span>
        <span id="deckCount" class="pile-label">deck</span>
      </button>
      <div id="scopaTable" class="scopa-table" aria-label="Cards on the table"></div>
      <div class="scopa-capture-column" aria-label="Captured cards">
        <div id="opponentCapture" class="scopa-capture-pile"></div>
        <div id="playerCapture" class="scopa-capture-pile"></div>
      </div>
    </div>
    <div class="hand-row">
      <div id="playerHand" class="hand" aria-label="Your cards"></div>
      <div id="playerTally" class="tally" hidden>
        <span class="tally-name">you</span>
        <span class="tally-total">0</span>
      </div>
    </div>`;

  return {
    board: document.getElementById("scopaBoard"),
    aiHand: document.getElementById("aiHand"),
    playerHand: document.getElementById("playerHand"),
    aiTally: document.getElementById("aiTally"),
    playerTally: document.getElementById("playerTally"),
    deck: document.getElementById("deck"),
    deckStack: document.getElementById("deckStack"),
    deckCount: document.getElementById("deckCount"),
    scopaTable: document.getElementById("scopaTable"),
    opponentCapture: document.getElementById("opponentCapture"),
    playerCapture: document.getElementById("playerCapture"),
  };
}

function renderCapturePile(container, cards, name, scopas) {
  container.innerHTML = "";
  const stack = document.createElement("div");
  stack.className = "scopa-capture-stack";
  cards.slice(-7).forEach((card, index) => {
    const button = cardElement(card, { faceUp: false });
    button.dataset.under = "true";
    button.style.setProperty("--capture-i", String(index));
    stack.appendChild(button);
  });
  if (!cards.length) stack.classList.add("empty");

  const label = document.createElement("span");
  label.className = "scopa-capture-label";
  const sweepText = scopas ? ` · ${scopas} ${scopas === 1 ? "scopa" : "scope"}` : "";
  label.textContent = `${name} · ${cards.length}${sweepText}`;
  container.append(stack, label);
}

function cardElement(card, { faceUp = false, owner = null, index = null, selectable = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card ${faceUp ? "face-up" : "face-down"}`;
  button.disabled = !selectable;
  button.dataset.cardId = card.id;
  if (owner) button.dataset.owner = owner;
  if (index !== null) button.dataset.index = String(index);
  if (selectable) button.classList.add("selectable");
  button.setAttribute("aria-label", faceUp ? `${prettyCard(card)}, value ${cardValue(card)}` : "face-down card");

  const red = card.suit === "♥" || card.suit === "♦";
  const rank = card.rank || "";
  const suit = card.suit || "";
  button.innerHTML = `
    <span class="card-inner">
      <span class="card-face card-back"></span>
      <span class="card-face card-front${red ? " red" : ""}" aria-hidden="true">
        <span class="card-corner"><span>${rank}</span><span class="card-suit">${suit}</span></span>
        <span class="card-center">${suit}</span>
        <span class="card-corner bottom"><span>${rank}</span><span class="card-suit">${suit}</span></span>
      </span>
    </span>`;
  return button;
}

function actionButton(label, className, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function setTally(tally, name, value) {
  tally.querySelector(".tally-name").textContent = name;
  tally.querySelector(".tally-total").textContent = String(value);
  tally.hidden = false;
}

function turnLabel(state, computerLevel = null) {
  if (state.status === "waiting") return "waiting for a friend";
  if (state.status === "round-finished") return `round ${state.roundNumber} over`;
  if (state.status === "match-finished") return "match over";
  if (state.currentPlayerId === state.youId) return "your turn";
  const opponent = otherPlayer(state)?.name || "opponent";
  return computerLevel ? `${opponent}’s turn · ${computerLevel}` : `${opponent}’s turn`;
}

function isInteractive(state, meta, online) {
  if (!online) return true;
  if (!meta.connected) return false;
  const opponent = otherPlayer(state);
  return !opponent || meta.connectedPlayerIds.includes(opponent.id);
}

function player(state, id) {
  return state.players.find((candidate) => candidate.id === id) || null;
}

function otherPlayer(state) {
  return state.players.find((candidate) => candidate.id !== state.youId) || null;
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
  baseEls.themeColor.content = dark ? "#161614" : "#f4f0e7";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
