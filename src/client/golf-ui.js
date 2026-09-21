import {
  cardsRemaining,
  canPlayOnWaste,
  createGolfGame,
  drawStockCard,
  playableColumns,
  playTableauCard,
  prettyGolfCard,
  undoGolfMove,
} from "./golf.js";
import { animateCards, snapshotCards } from "./card-motion.js?v=mobile-scopa-rail";

const els = {
  multiplayerBtn: document.getElementById("multiplayerBtn"),
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
  themeRadios: document.querySelectorAll('input[name="theme"]'),
  themeColor: document.querySelector('meta[name="theme-color"]'),
  newGameBtn: document.getElementById("newGameBtn"),
  turnLabel: document.getElementById("turnLabel"),
  resultLine: document.getElementById("resultLine"),
  message: document.getElementById("message"),
  actions: document.getElementById("actions"),
  table: document.querySelector(".table"),
};

let game = null;
let stockButton = null;
let waste = null;
let tableau = null;
let stockStack = null;
let stockLabel = null;

export function startGolf() {
  els.multiplayerBtn.hidden = true;
  els.computerSetting.hidden = true;
  buildTable();

  els.historyBtn.addEventListener("click", () => els.historyDialog.showModal());
  els.closeHistoryBtn.addEventListener("click", () => els.historyDialog.close());
  els.rulesBtn.addEventListener("click", () => els.rulesDialog.showModal());
  els.closeRulesBtn.addEventListener("click", () => els.rulesDialog.close());
  els.settingsBtn.addEventListener("click", openSettings);
  els.closeSettingsBtn.addEventListener("click", () => els.settingsDialog.close());
  els.newGameBtn.addEventListener("click", startNewGame);
  stockButton.addEventListener("click", drawFromStock);

  for (const radio of els.themeRadios) radio.addEventListener("change", () => applyTheme(radio.value));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateThemeColor);
  updateThemeColor();
  startNewGame();
}

function buildTable() {
  els.table.classList.add("golf-table");
  els.table.innerHTML = `
    <div id="golfStats" class="golf-stats" aria-live="polite"></div>
    <div id="golfTableau" class="golf-tableau" aria-label="Golf tableau"></div>
    <div class="table-center golf-center">
      <button id="deck" class="deck" type="button" aria-label="Turn a card from stock">
        <span id="deckStack" class="deck-stack"></span>
        <span id="deckCount" class="pile-label">stock</span>
      </button>
      <div id="discard" class="slot discard-pile golf-waste" aria-label="Current waste card"></div>
    </div>`;
  stockButton = document.getElementById("deck");
  stockStack = document.getElementById("deckStack");
  stockLabel = document.getElementById("deckCount");
  waste = document.getElementById("discard");
  tableau = document.getElementById("golfTableau");
}

function startNewGame() {
  game = createGolfGame(randomTools());
  render({ dealing: true });
}

function drawFromStock() {
  if (!game || !game.stock.length || game.status !== "playing") return;
  drawStockCard(game);
  render();
}

function playColumn(columnIndex) {
  if (!game || game.status !== "playing") return;
  try {
    playTableauCard(game, columnIndex);
    render();
  } catch {}
}

function undoMove() {
  if (undoGolfMove(game)) render();
}

function render({ dealing = false } = {}) {
  const before = snapshotCards(els.table);
  renderTableau(dealing);
  renderStock();
  renderWaste(dealing);
  renderStats();
  renderHistory();
  renderStatus();
  animateCards(before, { root: els.table, deck: stockButton, dealDelay: 35 });
}

function renderTableau(dealing) {
  tableau.innerHTML = "";
  const playable = new Set(playableColumns(game));
  game.tableau.forEach((column, columnIndex) => {
    const container = document.createElement("div");
    container.className = "golf-column";
    container.setAttribute("aria-label", `Column ${columnIndex + 1}, ${column.length} cards`);

    column.forEach((card, cardIndex) => {
      const topCard = cardIndex === column.length - 1;
      const button = cardElement(card, {
        selectable: topCard && playable.has(columnIndex),
        columnIndex,
        dealOrder: dealing ? cardIndex * 7 + columnIndex : null,
      });
      button.style.setProperty("--golf-card-i", String(cardIndex));
      if (!topCard) button.classList.add("golf-covered");
      if (topCard) button.addEventListener("click", () => playColumn(columnIndex));
      container.appendChild(button);
    });

    if (!column.length) {
      const cleared = document.createElement("span");
      cleared.className = "golf-cleared";
      cleared.textContent = "cleared";
      container.appendChild(cleared);
    }
    tableau.appendChild(container);
  });
}

function renderStock() {
  const layers = Math.min(5, Math.ceil(game.stock.length / 4));
  stockStack.innerHTML = "";
  for (let index = 0; index < layers; index += 1) {
    const layer = document.createElement("span");
    layer.className = "deck-layer";
    layer.style.setProperty("--i", String(index));
    stockStack.appendChild(layer);
  }
  const canDraw = game.status === "playing" && game.stock.length > 0;
  stockButton.disabled = !canDraw;
  stockButton.classList.toggle("ready", canDraw);
  stockLabel.textContent = `stock · ${game.stock.length}`;
}

function renderWaste(dealing) {
  waste.innerHTML = "";
  if (game.waste) waste.appendChild(cardElement(game.waste, { dealOrder: dealing ? 35 : null }));
  const label = document.createElement("span");
  label.className = "pile-label";
  label.textContent = "waste";
  waste.appendChild(label);
}

function renderStats() {
  const stats = document.getElementById("golfStats");
  stats.innerHTML = `<span>${cardsRemaining(game)} cards left</span><span>${game.moves} moves</span>`;
}

function renderHistory() {
  for (const list of [els.historyList, els.historyListModal]) {
    list.innerHTML = "";
    for (const entry of game.history.slice(-10).reverse()) {
      const item = document.createElement("li");
      item.className = "history-group";
      const who = document.createElement("span");
      who.className = "history-who";
      who.textContent = entry.type === "deal" ? "round" : "you";
      const line = document.createElement("span");
      line.className = "history-line";
      line.textContent = historyText(entry);
      item.append(who, line);
      list.appendChild(item);
    }
  }
}

function renderStatus() {
  els.turnLabel.classList.toggle("active", game.status === "playing");
  els.resultLine.hidden = game.status === "playing";

  if (game.status === "won") {
    els.turnLabel.textContent = "course cleared";
    els.resultLine.textContent = "you win";
    els.message.textContent = `You cleared all 35 cards in ${game.moves} moves.`;
  } else if (game.status === "lost") {
    els.turnLabel.textContent = "no moves left";
    els.resultLine.textContent = "round over";
    els.message.textContent = "The stock is empty and no exposed card fits. Undo, or start a new game.";
  } else {
    els.turnLabel.textContent = "your turn";
    els.message.textContent = playableColumns(game).length
      ? "Choose an exposed card one rank above or below the waste."
      : "No exposed card fits. Turn a card from the stock.";
  }

  els.actions.innerHTML = "";
  if (game.undoStack.length) els.actions.appendChild(actionButton("undo", "secondary-button", undoMove));
  if (game.status !== "playing") els.actions.appendChild(actionButton("play again", "primary-button", startNewGame));
}

function historyText(entry) {
  if (entry.type === "deal") return "Started a new round.";
  if (entry.type === "draw") return `Turned ${prettyGolfCard(entry.card)} from the stock.`;
  return `Played ${prettyGolfCard(entry.card)} from column ${entry.columnIndex + 1}.`;
}

function actionButton(label, className, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function cardElement(card, { selectable = false, columnIndex = null, dealOrder = null } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card face-up${selectable ? " selectable" : ""}`;
  button.disabled = !selectable;
  button.dataset.cardId = card.id;
  if (dealOrder !== null) button.dataset.deal = String(dealOrder);
  if (columnIndex !== null) {
    button.dataset.owner = "player";
    button.dataset.index = String(columnIndex);
  }
  button.setAttribute("aria-label", selectable ? `Play ${prettyGolfCard(card)}` : prettyGolfCard(card));

  const red = card.suit === "♥" || card.suit === "♦";
  button.innerHTML = `
    <span class="card-inner">
      <span class="card-face card-back"></span>
      <span class="card-face card-front${red ? " red" : ""}" aria-hidden="true">
        <span class="card-corner"><span>${card.rank}</span><span class="card-suit">${card.suit}</span></span>
        <span class="card-center">${card.suit}</span>
        <span class="card-corner bottom"><span>${card.rank}</span><span class="card-suit">${card.suit}</span></span>
      </span>
    </span>`;
  return button;
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
