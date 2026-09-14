import { prettyCard, scoreCard } from "../shared/games/yaniv.js";
import { animateCards, snapshotCards } from "./card-motion.js";
import { revealScoreCard, runScoreCount, scoreValueBadge, setTallyValue } from "./score-motion.js";

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
  rulesBtn: document.getElementById("rulesBtn"),
  rulesDialog: document.getElementById("rulesDialog"),
  closeRulesBtn: document.getElementById("closeRulesBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsDialog: document.getElementById("settingsDialog"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  computerSetting: document.getElementById("computerSetting"),
  themeRadios: document.querySelectorAll('input[name="theme"]'),
  themeColor: document.querySelector('meta[name="theme-color"]'),
  playerTally: document.getElementById("playerTally"),
  aiTally: document.getElementById("aiTally"),
  resultLine: document.getElementById("resultLine"),
  newGameBtn: document.getElementById("newGameBtn"),
};

export function createYanivTable({ dispatch, onNewGame = null, online = false }) {
  let state = null;
  let meta = { connected: true, busy: false, connectedPlayerIds: [] };
  let countedRound = null;
  let countToken = 0;
  let countProgress = { player: 0, opponent: 0, active: null };
  let countHands = [];

  els.computerSetting.hidden = true;
  els.rulesBtn.addEventListener("click", () => els.rulesDialog.showModal());
  els.closeRulesBtn.addEventListener("click", () => els.rulesDialog.close());
  els.historyBtn.addEventListener("click", () => els.historyDialog.showModal());
  els.closeHistoryBtn.addEventListener("click", () => els.historyDialog.close());
  els.settingsBtn.addEventListener("click", openSettings);
  els.closeSettingsBtn.addEventListener("click", () => els.settingsDialog.close());
  els.deck.addEventListener("click", () => act("DRAW_DECK"));
  els.discard.addEventListener("click", () => act("DRAW_DISCARD"));

  if (onNewGame) els.newGameBtn.addEventListener("click", onNewGame);
  else els.newGameBtn.hidden = true;

  for (const radio of els.themeRadios) radio.addEventListener("change", () => applyTheme(radio.value));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateThemeColor);
  updateThemeColor();

  function act(type, extra = {}) {
    if (!state?.legalActions.includes(type) || meta.busy || !isInteractive(state, meta, online)) return;
    dispatch({ type, ...extra });
  }

  function render(nextState, nextMeta = {}) {
    const before = snapshotCards();
    state = nextState;
    meta = { ...meta, message: "", ...nextMeta };
    if (!state) return renderEmpty(meta.message || "Loading Yaniv…");
    renderHands(state, meta, online, act);
    renderCenter(state);
    renderDock(state, meta, online, act);
    renderHistory(state);
    renderScores(state);
    animateCards(before);
    syncScoreCount();
  }

  function renderEmpty(message = "Loading Yaniv…") {
    state = null;
    els.aiHand.innerHTML = "";
    els.playerHand.innerHTML = "";
    els.held.innerHTML = "";
    els.discard.innerHTML = '<span class="pile-label">discard</span>';
    els.deckStack.innerHTML = "";
    els.deckCount.textContent = "deck";
    els.actions.innerHTML = "";
    els.deck.disabled = true;
    els.deck.classList.remove("ready");
    els.discard.classList.add("empty");
    els.discard.classList.remove("ready");
    els.discard.setAttribute("aria-disabled", "true");
    clearScoreCount();
    els.playerTally.hidden = true;
    els.aiTally.hidden = true;
    els.resultLine.hidden = true;
    els.turnLabel.textContent = "yaniv";
    els.message.textContent = message;
  }

  function syncScoreCount() {
    if (!roundIsOver()) {
      if (countedRound !== null) clearScoreCount();
      return;
    }

    const roundKey = `${state.status}:${state.roundNumber}`;
    if (countedRound === roundKey) {
      repaintScoreCount();
      return;
    }

    countedRound = roundKey;
    runYanivScoreCount((countToken += 1));
  }

  async function runYanivScoreCount(token) {
    const you = player(state, state.youId);
    const opponent = otherPlayer(state);
    countProgress = { player: 0, opponent: 0, active: null };
    countHands = [
      makeCountHand("player", you, els.playerHand, els.playerTally),
      makeCountHand("opponent", opponent, els.aiHand, els.aiTally),
    ];
    els.resultLine.hidden = true;

    for (const hand of countHands) {
      setTally(hand.tally, hand.player?.name || hand.side, hand.startingScore);
    }

    const complete = await runScoreCount({
      hands: countHands,
      shouldContinue: () => token === countToken && roundIsOver(),
      onHandStart: (hand) => {
        countProgress.active = hand.side;
        hand.container.classList.add("tallying");
        hand.tally.classList.add("active");
      },
      onCard: (hand, card, index) => {
        const value = scoreCard(card);
        hand.runningScore += hand.countsTowardScore ? value : 0;
        countProgress[hand.side] = index + 1;
        revealScoreCard(hand.container.children[index], value);
        setTallyValue(hand.tally, hand.runningScore);
      },
      onHandEnd: (hand) => {
        countProgress.active = null;
        hand.container.classList.remove("tallying");
        hand.tally.classList.remove("active");
      },
    });

    if (complete && token === countToken && roundIsOver()) settleScoreCount();
  }

  function makeCountHand(side, candidate, container, tally) {
    const cards = candidate?.hand || [];
    const roundScore = state.roundScores?.[candidate?.id] || 0;
    const handValue = cards.reduce((total, card) => total + scoreCard(card), 0);
    return {
      side,
      player: candidate,
      cards,
      container,
      tally,
      startingScore: (state.scores?.[candidate?.id] || 0) - roundScore,
      runningScore: (state.scores?.[candidate?.id] || 0) - roundScore,
      countsTowardScore: roundScore >= handValue,
    };
  }

  function settleScoreCount() {
    countProgress = {
      player: player(state, state.youId)?.hand.length || 0,
      opponent: otherPlayer(state)?.hand.length || 0,
      active: null,
    };
    repaintScoreCount();
    for (const hand of countHands) {
      hand.tally.classList.remove("active");
      setTallyValue(hand.tally, state.scores?.[hand.player?.id] || 0);
    }

    const winnerIds = state.status === "match-finished" ? state.matchWinnerIds : [state.roundWinnerId];
    els.playerTally.classList.toggle("winner", winnerIds.length === 1 && winnerIds.includes(state.youId));
    els.aiTally.classList.toggle("winner", winnerIds.length === 1 && winnerIds.includes(otherPlayer(state)?.id));
    els.resultLine.textContent = roundResultText();
    els.resultLine.hidden = false;
  }

  function repaintScoreCount() {
    for (const hand of countHands) {
      hand.container.classList.toggle("tallying", countProgress.active === hand.side);
      [...hand.container.children].forEach((card, index) => {
        const counted = index < countProgress[hand.side];
        card.classList.toggle("counted", counted);
        const badge = card.querySelector(".card-value");
        if (counted && hand.cards[index] && !badge) card.appendChild(scoreValueBadge(scoreCard(hand.cards[index])));
        else if (!counted && badge) badge.remove();
      });
    }
  }

  function clearScoreCount() {
    countToken += 1;
    countedRound = null;
    countProgress = { player: 0, opponent: 0, active: null };
    countHands = [];
    for (const tally of [els.playerTally, els.aiTally]) tally.classList.remove("active", "winner");
    for (const hand of [els.playerHand, els.aiHand]) hand.classList.remove("tallying");
  }

  function roundIsOver() {
    return state?.status === "round-finished" || state?.status === "match-finished";
  }

  function roundResultText() {
    if (state.status === "round-finished") {
      const winner = player(state, state.roundWinnerId);
      const winnerText = winner?.id === state.youId ? "you win" : `${winner?.name || "opponent"} wins`;
      return state.assaf ? `assaf · ${winnerText}` : `${winnerText} the round`;
    }
    const winners = state.matchWinnerIds.map((id) => player(state, id)?.name).filter(Boolean);
    const youWon = state.matchWinnerIds.length === 1 && state.matchWinnerIds[0] === state.youId;
    return winners.length > 1 ? "tie match" : youWon ? "you win the match" : `${winners[0] || "opponent"} wins the match`;
  }

  renderEmpty();
  return { render, renderEmpty };
}

function renderHands(state, meta, online, act) {
  const you = player(state, state.youId);
  const opponent = otherPlayer(state);
  els.playerHand.setAttribute("aria-label", `${you?.name || "Your"} cards`);
  els.aiHand.setAttribute("aria-label", `${opponent?.name || "Opponent"} cards`);
  renderHand(els.playerHand, you?.hand || [], "player", state, meta, online, act);
  renderHand(els.aiHand, opponent?.hand || [], "opponent", state, meta, online, act);
}

function renderHand(container, hand, owner, state, meta, online, act) {
  const selectable = owner === "player"
    && state.legalActions.includes("TOGGLE_CARD")
    && !meta.busy
    && isInteractive(state, meta, online);
  container.innerHTML = "";
  hand.forEach((card, index) => {
    const button = cardElement(card, {
      faceUp: !card.hidden,
      owner,
      index,
      selectable,
    });
    if (owner === "player" && state.selectedIndices.includes(index)) button.classList.add("selected");
    button.dataset.deal = String(index * 2 + (owner === "opponent" ? 1 : 0));
    if (selectable) button.addEventListener("click", () => act("TOGGLE_CARD", { index }));
    container.appendChild(button);
  });
}

function renderCenter(state) {
  const layers = Math.min(6, Math.ceil(state.deckCount / 9));
  if (els.deckStack.childElementCount !== layers) {
    els.deckStack.innerHTML = "";
    for (let index = 0; index < layers; index += 1) {
      const layer = document.createElement("span");
      layer.className = "deck-layer";
      layer.style.setProperty("--i", String(index));
      els.deckStack.appendChild(layer);
    }
  }
  els.deckCount.textContent = `deck · ${state.deckCount}`;

  const playLabel = state.pendingDiscard.length
    ? state.currentPlayerId === state.youId ? "your play" : "their play"
    : "play";
  renderMeld(els.held, state.pendingDiscard, playLabel, "pending-play");
  renderMeld(els.discard, state.discard, "discard", "discard-pile");
}

function renderMeld(container, cards, label, className) {
  container.className = `slot ${className}`;
  container.setAttribute(
    "aria-label",
    container === els.discard && cards.length
      ? `Take ${prettyCard(cards.at(-1))} from the discard`
      : label,
  );
  container.innerHTML = "";
  cards.forEach((card, index) => {
    const button = cardElement(card, { faceUp: true });
    button.dataset.deal = String(10 + index);
    button.style.setProperty("--meld-i", String(index));
    button.style.rotate = `${(index - (cards.length - 1) / 2) * 4}deg`;
    container.appendChild(button);
  });
  container.classList.toggle("empty", cards.length === 0);
  const caption = document.createElement("span");
  caption.className = "pile-label";
  caption.textContent = label;
  container.appendChild(caption);
}

function renderDock(state, meta, online, act) {
  const legal = new Set(state.legalActions);
  const interactive = isInteractive(state, meta, online) && !meta.busy;
  const canDrawDeck = interactive && legal.has("DRAW_DECK");
  const canDrawDiscard = interactive && legal.has("DRAW_DISCARD") && state.discard.length > 0;

  els.deck.disabled = !canDrawDeck;
  els.deck.classList.toggle("ready", canDrawDeck);
  els.discard.classList.toggle("ready", canDrawDiscard);
  els.discard.setAttribute("aria-disabled", String(!canDrawDiscard));
  els.turnLabel.textContent = turnLabel(state);
  els.turnLabel.classList.toggle("active", state.currentPlayerId === state.youId && state.status === "playing");
  els.message.textContent = statusMessage(state, meta, online);

  els.actions.innerHTML = "";
  const actions = [];
  if (legal.has("PLAY_SELECTED")) actions.push(["play cards", "PLAY_SELECTED", true]);
  if (legal.has("CALL_YANIV")) actions.push(["call yaniv", "CALL_YANIV", true]);
  if (legal.has("READY_NEXT")) actions.push(["next round", "READY_NEXT", true]);
  if (legal.has("REMATCH")) actions.push(["play again", "REMATCH", true]);
  for (const [label, type, primary] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = primary ? "primary-button" : "secondary-button";
    button.textContent = label;
    button.disabled = !interactive;
    button.addEventListener("click", () => act(type));
    els.actions.appendChild(button);
  }
}

function renderScores(state) {
  const you = player(state, state.youId);
  const opponent = otherPlayer(state);
  setTally(els.playerTally, you?.name || "you", state.scores?.[state.youId] || 0);
  setTally(els.aiTally, opponent?.name || "opponent", state.scores?.[opponent?.id] || 0);

  if (state.status !== "round-finished" && state.status !== "match-finished") {
    els.resultLine.hidden = true;
    els.resultLine.textContent = "";
  }
}

function setTally(tally, name, value) {
  tally.querySelector(".tally-name").textContent = name;
  tally.querySelector(".tally-total").textContent = String(value);
  tally.hidden = false;
}

function renderHistory(state) {
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

function turnLabel(state) {
  if (state.status === "waiting") return "waiting for a friend";
  if (state.status === "round-finished") return `round ${state.roundNumber} over`;
  if (state.status === "match-finished") return "match over";
  if (state.currentPlayerId === state.youId) return "your turn";
  return `${otherPlayer(state)?.name || "opponent"}’s turn`;
}

function statusMessage(state, meta, online) {
  if (meta.message) return meta.message;
  if (online && !meta.connected) return "Reconnecting…";
  const opponent = otherPlayer(state);
  if (online && opponent && !meta.connectedPlayerIds.includes(opponent.id)) return `${opponent.name} disconnected. Waiting for them to return…`;
  if (state.status === "waiting") return "Share the invite link with one other player.";
  if (state.status === "round-finished" || state.status === "match-finished") {
    const youAdd = state.roundScores?.[state.youId] || 0;
    const opponentAdd = state.roundScores?.[opponent?.id] || 0;
    const summary = `This round: you +${youAdd}, ${opponent?.name || "opponent"} +${opponentAdd}.`;
    if (player(state, state.youId)?.ready) return `${summary} Waiting for ${opponent?.name || "the other player"}…`;
    return `${summary} Match totals are shown beside the hands.`;
  }
  if (state.currentPlayerId !== state.youId) return `${opponent?.name || "Your opponent"} is taking their turn.`;
  if (state.phase === "await-draw") return "Now draw one card from the deck or discard to finish your turn.";
  if (state.selectedIndices.length && state.legalActions.includes("PLAY_SELECTED")) return "Play this selection, or add another card to it.";
  if (state.selectedIndices.length) return "That selection needs another card to become a valid set or run.";
  if (state.legalActions.includes("CALL_YANIV")) return "Select cards to play, or call Yaniv with 5 points or fewer.";
  return "Select one card, a same-rank set, or a suited run of at least three.";
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

function cardElement(card, { faceUp = false, owner = null, index = null, selectable = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card ${faceUp ? "face-up" : "face-down"}`;
  button.disabled = !selectable;
  button.dataset.cardId = card.id;
  if (owner) button.dataset.owner = owner;
  if (index !== null) button.dataset.index = String(index);
  button.setAttribute("aria-label", faceUp ? `${prettyCard(card)}, ${scoreCard(card)} points` : "face-down card");
  if (selectable) button.classList.add("selectable");

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
