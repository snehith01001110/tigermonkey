import { CARD_MOVE_MS, animateCards, cardDealDuration, snapshotCards } from "./src/client/card-motion.js?v=mobile-scopa-rail";
import { revealScoreCard, runScoreCount, scoreValueBadge, setTallyValue } from "./src/client/score-motion.js?v=mobile-scopa-rail";

(() => {
  const SUITS = ["♠", "♥", "♦", "♣"];
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

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
    themeColor: document.querySelector('meta[name="theme-color"]'),
    settingsBtn: document.getElementById("settingsBtn"),
    settingsDialog: document.getElementById("settingsDialog"),
    closeSettingsBtn: document.getElementById("closeSettingsBtn"),
    levelRadios: document.querySelectorAll('input[name="level"]'),
    themeRadios: document.querySelectorAll('input[name="theme"]'),
    levelPending: document.getElementById("levelPending"),
    levelPendingText: document.getElementById("levelPendingText"),
    newGameNowBtn: document.getElementById("newGameNowBtn"),
    rulesBtn: document.getElementById("rulesBtn"),
    closeRulesBtn: document.getElementById("closeRulesBtn"),
    rulesDialog: document.getElementById("rulesDialog"),
    playerTally: document.getElementById("playerTally"),
    aiTally: document.getElementById("aiTally"),
    resultLine: document.getElementById("resultLine"),
    newGameBtn: document.getElementById("newGameBtn"),
  };

  let state;
  let shownHistory = null;
  let shownCount = 0;

  const MOVE_MS = CARD_MOVE_MS;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const POWER_LABELS = {
    "peek-own": "peek yours",
    "peek-opponent": "peek theirs",
    "blind-swap": "blind swap",
    "swap-check": "swap, then check",
    "check-swap": "check, then swap",
  };
  const WHO_LABELS = { you: "you", computer: "computer", round: "round" };
  const LEVELS = ["easy", "medium", "hard"];
  let level = savedLevel();

  function savedLevel() {
    try {
      const saved = localStorage.getItem("level");
      if (LEVELS.includes(saved)) return saved;
    } catch {}
    return "medium";
  }

  function freshState() {
    const deck = shuffle(makeDeck());
    const player = deck.splice(0, 4);
    const ai = deck.splice(0, 4);
    const firstDiscard = deck.pop();
    return {
      deck,
      discard: [firstDiscard],
      player,
      ai,
      turn: "player",
      phase: "dealing",
      drawn: null,
      drawnSource: null,
      aiDrawn: null,
      aiDrawnShown: false,
      selectedOwn: null,
      selectedOpp: null,
      pendingPower: null,
      playerTurnCount: 0,
      aiTurnCount: 0,
      playerKnown: new Set([2, 3]),
      aiKnown: new Set([2, 3]),
      aiKnowsPlayer: new Set(),
      temporaryPlayerReveal: new Set(),
      temporaryAiReveal: new Set(),
      lifted: new Set(),
      counted: { player: 0, ai: 0 },
      caboCaller: null,
      finalTurnOwner: null,
      gameOver: false,
      scores: null,
      history: [],
      level,
    };
  }

  function makeDeck() {
    const cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push({ rank, suit, id: `${rank}${suit}-${cards.length}` });
    }
    cards.push({ rank: "JOKER", suit: "", id: "joker-1" });
    cards.push({ rank: "JOKER", suit: "", id: "joker-2" });
    return cards;
  }

  function shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  function score(card) {
    if (card.rank === "JOKER") return 0;
    if (card.rank === "K" && (card.suit === "♥" || card.suit === "♦")) return -1;
    if (card.rank === "A") return 1;
    if (/^\d+$/.test(card.rank)) return Number(card.rank);
    if (card.rank === "J") return 11;
    if (card.rank === "Q") return 12;
    return 13;
  }

  // A hand is a fixed set of spots: a card that leaves the hand empties its spot instead
  // of sliding the rest up, so every card you've memorized stays where you left it. A card
  // coming in takes the first empty spot, and only grows the hand when every spot is filled.
  function placeCard(hand, card) {
    const empty = hand.indexOf(null);
    if (empty !== -1) {
      hand[empty] = card;
      return empty;
    }
    hand.push(card);
    return hand.length - 1;
  }

  function sameRank(a, b) {
    if (!a || !b) return false;
    return a.rank === b.rank;
  }

  function powerFor(card) {
    if (!card) return null;
    if (card.rank === "7" || card.rank === "8") return "peek-own";
    if (card.rank === "9" || card.rank === "10") return "peek-opponent";
    if (card.rank === "J") return "blind-swap";
    if (card.rank === "Q") return "swap-check";
    if (card.rank === "K") return "check-swap";
    return null;
  }

  function refillDeckIfNeeded() {
    if (state.deck.length > 0) return;
    const top = state.discard.pop();
    state.deck = shuffle(state.discard.splice(0));
    state.discard = [top];
  }

  function cardElement(card, { faceUp = false, index = null, owner = null, selectable = false } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `card ${faceUp ? "face-up" : "face-down"}`;
    button.disabled = !selectable;
    button.dataset.cardId = card.id;
    button.setAttribute("aria-label", faceUp ? pretty(card) : "face-down card");
    if (selectable) button.classList.add("selectable");
    if (index !== null) button.dataset.index = String(index);
    if (owner) button.dataset.owner = owner;

    const red = card.suit === "♥" || card.suit === "♦";
    const label = card.rank === "JOKER" ? "★" : card.rank;
    const suit = card.rank === "JOKER" ? "" : card.suit;
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

  function render() {
    const before = snapshotCards();
    renderHands();
    renderCenter();
    renderDock();
    renderHistory();
    animateCards(before);
  }

  function renderHands() {
    renderHand(els.playerHand, state.player, "player");
    renderHand(els.aiHand, state.ai, "ai");
  }

  function renderHand(container, hand, owner) {
    const reveal = owner === "player" ? state.temporaryPlayerReveal : state.temporaryAiReveal;
    const selected = owner === "player" ? state.selectedOwn : state.selectedOpp;
    container.innerHTML = "";
    hand.forEach((card, index) => {
      if (!card) {
        container.appendChild(emptySlot());
        return;
      }
      const faceUp = state.gameOver || reveal.has(index);
      const el = cardElement(card, { faceUp, index, owner, selectable: canSelectCard(owner, index) });
      el.dataset.deal = String(index * 2 + (owner === "ai" ? 1 : 0));
      if (index < state.counted[owner]) el.appendChild(scoreValueBadge(score(card)));
      if (selected === index) el.classList.add("selected");
      if (state.lifted.has(`${owner}:${index}`)) el.classList.add("lifted");
      el.addEventListener("click", () => handleCardClick(owner, index));
      container.appendChild(el);
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
    // A fuller deck is a taller stack; only rebuild it when its height changes.
    const layers = Math.min(6, Math.ceil(state.deck.length / 9));
    if (els.deckStack.childElementCount !== layers) {
      els.deckStack.innerHTML = "";
      for (let i = 0; i < layers; i++) {
        const layer = document.createElement("span");
        layer.className = "deck-layer";
        layer.style.setProperty("--i", String(i));
        els.deckStack.appendChild(layer);
      }
    }
    els.deckCount.textContent = `deck · ${state.deck.length}`;

    els.held.innerHTML = "";
    if (state.drawn) els.held.appendChild(cardElement(state.drawn, { faceUp: true }));
    else if (state.aiDrawn) els.held.appendChild(cardElement(state.aiDrawn, { faceUp: state.aiDrawnShown }));

    // Show the top few discards, each at a slight angle, so the pile reads as a pile.
    els.discard.innerHTML = "";
    const pile = state.discard.slice(-3);
    pile.forEach((card, i) => {
      const el = cardElement(card, { faceUp: true });
      el.style.rotate = `${tilt(card)}deg`;
      if (i < pile.length - 1) el.dataset.under = "true";
      else el.dataset.deal = "99";
      els.discard.appendChild(el);
    });
    els.discard.classList.toggle("empty", pile.length === 0);
    const label = document.createElement("span");
    label.className = "pile-label";
    label.textContent = "discard";
    els.discard.appendChild(label);
  }

  function tilt(card) {
    let hash = 0;
    for (const ch of card.id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    return (Math.abs(hash) % 9) - 4;
  }

  function actionButton(label, className, fn) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  }

  function renderDock() {
    const yours = state.turn === "player" && !state.gameOver && state.phase !== "dealing";
    els.turnLabel.textContent = turnLabel();
    els.turnLabel.classList.toggle("active", yours);

    const canDraw = yours && state.phase === "await-draw";
    els.deck.disabled = !canDraw;
    els.deck.classList.toggle("ready", canDraw);
    els.discard.classList.toggle("ready", canDraw && state.discard.length > 0);
    els.discard.setAttribute("aria-disabled", String(!(canDraw && state.discard.length > 0)));

    els.actions.innerHTML = "";
    for (const [label, fn, primary] of availableActions()) {
      els.actions.appendChild(actionButton(label, primary ? "primary-button" : "secondary-button", fn));
    }
  }

  function turnLabel() {
    if (state.gameOver) return state.phase === "counting" ? "counting up" : "round over";
    if (state.phase === "dealing") return "dealing";
    if (state.turn === "ai") return `computer's turn · ${state.level}`;
    return state.caboCaller === "ai" ? "your final turn" : "your turn";
  }

  // The dock only offers what makes sense right now; drawing is done by tapping the piles.
  function availableActions() {
    if (state.gameOver) return state.phase === "counting" ? [["skip", settleCount]] : [["play again", startGame, true]];
    if (state.turn !== "player") return [];
    switch (state.phase) {
      case "initial-peek":
        return [["got it", finishInitialPeek, true]];
      case "await-draw": {
        const actions = [];
        if (state.player.some(Boolean)) actions.push(["match discard", enterMatchMode]);
        if (!state.caboCaller) actions.push(["call cabo", callCabo, true]);
        return actions;
      }
      case "drawn": {
        const power = POWER_LABELS[powerFor(state.drawn)];
        return [[power ? `discard · ${power}` : "discard", playerDiscardDrawn]];
      }
      case "match-mode":
        return [["cancel", cancelMatch]];
      case "king-swap-choice":
        return [["keep hands", keepHands], ["swap", executeKingSwap, true]];
      default:
        return state.phase.startsWith("power-") && state.phase !== "power-resolving" ? [["skip", skipPower]] : [];
    }
  }

  function say(text) {
    els.message.textContent = text;
  }

  // History keeps only what both players saw, so it never gives away a hidden card.
  // Parts are strings or cards; cards are shown by name.
  function record(who, ...parts) {
    state.history.push({ who, parts });
  }

  // Newest turn first; consecutive moves by the same player share one heading.
  function renderHistory() {
    if (shownHistory === state.history && shownCount === state.history.length) return;
    const firstNew = shownHistory === state.history ? shownCount : state.history.length;
    shownHistory = state.history;
    shownCount = state.history.length;

    const groups = [];
    state.history.forEach((entry, i) => {
      const last = groups[groups.length - 1];
      if (last && last.who === entry.who) last.lines.push({ entry, i });
      else groups.push({ who: entry.who, lines: [{ entry, i }] });
    });

    for (const list of [els.historyList, els.historyListModal]) {
      list.innerHTML = "";
      for (const group of groups.slice(-8).reverse()) {
        const item = document.createElement("li");
        item.className = "history-group";
        const who = document.createElement("span");
        who.className = "history-who";
        who.textContent = WHO_LABELS[group.who];
        item.appendChild(who);
        for (const { entry, i } of group.lines) {
          const line = document.createElement("span");
          line.className = i >= firstNew ? "history-line fresh" : "history-line";
          for (const part of entry.parts) line.appendChild(historyPart(part));
          item.appendChild(line);
        }
        list.appendChild(item);
      }
    }
  }

  function historyPart(part) {
    if (typeof part === "string") return document.createTextNode(part);
    const name = document.createElement("span");
    name.className = part.suit === "♥" || part.suit === "♦" ? "history-card red" : "history-card";
    name.textContent = pretty(part);
    return name;
  }

  // Where a card sits as you see it, e.g. "top-left". The computer's grid is rotated.
  function spot(owner, index) {
    const count = (owner === "player" ? state.player : state.ai).length;
    const rows = Math.ceil(count / 2);
    let row = Math.floor(index / 2);
    let col = index % 2;
    if (owner === "ai") {
      row = rows - 1 - row;
      col = 1 - col;
    }
    const side = col ? "right" : "left";
    const rowName = rows === 1 ? "" : row === 0 ? "top" : row === rows - 1 ? "bottom" : "middle";
    if (count % 2 === 1 && index === count - 1) return rowName || "only";
    return rowName ? `${rowName}-${side}` : side;
  }

  function canSelectCard(owner, index) {
    if (state.gameOver || state.turn !== "player") return false;
    if (!(owner === "player" ? state.player : state.ai)[index]) return false;
    if (owner === "player") {
      return ["drawn", "choose-replace", "match-mode", "power-peek-own", "power-j-own", "power-q-own", "power-k-own"].includes(state.phase);
    }
    return ["power-peek-opponent", "power-j-opponent", "power-q-opponent", "power-k-check-opponent"].includes(state.phase);
  }

  function handleCardClick(owner, index) {
    if (!canSelectCard(owner, index)) return;

    if (owner === "player") {
      if (state.phase === "drawn" || state.phase === "choose-replace") return replaceWithDrawn(index);
      if (state.phase === "match-mode") return tryPlayerMatch(index);
      if (state.phase === "power-peek-own") return playerPeekOwn(index);
      if (state.phase === "power-j-own") {
        state.selectedOwn = index;
        state.phase = "power-j-opponent";
        say("Now choose one computer card. You won't see either first.");
        return render();
      }
      if (state.phase === "power-q-own") {
        state.selectedOwn = index;
        state.phase = "power-q-opponent";
        say("Choose one computer card to swap with.");
        return render();
      }
      if (state.phase === "power-k-own") {
        state.selectedOwn = index;
        state.phase = "king-swap-choice";
        say("Swap your selected card with the card you just checked?");
        return render();
      }
    } else {
      if (state.phase === "power-peek-opponent") return playerPeekOpponent(index);
      if (state.phase === "power-j-opponent") return playerBlindSwap(index);
      if (state.phase === "power-q-opponent") return playerSwapCheck(index);
      if (state.phase === "power-k-check-opponent") return playerKingCheck(index);
    }
  }

  function startGame() {
    state = freshState();
    clearCountUp();
    record("round", `Cards dealt. The computer is on ${state.level}.`);
    // Clear the old table so the new hands are dealt from the deck, not slid over.
    for (const el of [els.aiHand, els.playerHand, els.held, els.discard]) el.innerHTML = "";
    say("Dealing…");
    render();
    later(() => {
      state.temporaryPlayerReveal = new Set([2, 3]);
      state.phase = "initial-peek";
      say("Memorize your bottom two cards, then press got it.");
      render();
    }, cardDealDuration(9) + 200);
  }

  function finishInitialPeek() {
    if (state.phase !== "initial-peek") return;
    state.temporaryPlayerReveal.clear();
    state.phase = "await-draw";
    say("Your turn. Draw from the deck, or take the discard.");
    render();
  }

  function drawFromDeck() {
    if (state.turn !== "player" || state.phase !== "await-draw") return;
    refillDeckIfNeeded();
    state.drawn = state.deck.pop();
    state.drawnSource = "deck";
    state.phase = "drawn";
    record("you", "Drew from the deck.");
    say(`You drew ${pretty(state.drawn)}. Choose one of your cards to swap it in, or discard it${powerFor(state.drawn) ? " to use its power" : ""}.`);
    render();
  }

  function drawFromDiscard() {
    if (state.turn !== "player" || state.phase !== "await-draw") return;
    if (!state.discard.length) return;
    state.drawn = state.discard.pop();
    state.drawnSource = "discard";
    state.phase = "choose-replace";
    record("you", "Took ", state.drawn, " from the discard.");
    say(`You took ${pretty(state.drawn)}. Choose one of your cards to swap it in.`);
    render();
  }

  function replaceWithDrawn(index) {
    const old = state.player[index];
    state.player[index] = state.drawn;
    state.discard.push(old);
    state.playerKnown.add(index);
    // The computer loses track of this spot, unless the new card came face-up from the discard.
    state.aiKnowsPlayer.delete(index);
    if (tracks() && state.drawnSource === "discard") state.aiKnowsPlayer.add(index);
    state.drawn = null;
    state.drawnSource = null;
    record("you", `Put it in your ${spot("player", index)} spot, discarding `, old, ".");
    say(`You replaced a card and discarded ${pretty(old)}.`);
    endPlayerTurn();
  }

  function playerDiscardDrawn() {
    if (!state.drawn || state.drawnSource !== "deck") return;
    const card = state.drawn;
    state.discard.push(card);
    record("you", "Discarded ", card, ".");
    state.drawn = null;
    state.drawnSource = null;
    const power = powerFor(card);
    if (!power) {
      say(`You discarded ${pretty(card)}.`);
      return endPlayerTurn();
    }
    beginPlayerPower(power);
  }

  function beginPlayerPower(power) {
    state.pendingPower = power;
    state.selectedOwn = null;
    state.selectedOpp = null;

    if (power === "peek-own") {
      state.phase = "power-peek-own";
      say("Choose one of your cards to peek at.");
    } else if (power === "peek-opponent") {
      state.phase = "power-peek-opponent";
      say("Choose one computer card to peek at.");
    } else if (power === "blind-swap") {
      state.phase = "power-j-own";
      say("Choose one of your cards for a blind swap.");
    } else if (power === "swap-check") {
      state.phase = "power-q-own";
      say("Choose one of your cards to swap.");
    } else if (power === "check-swap") {
      state.phase = "power-k-check-opponent";
      say("Choose one computer card to check first.");
    }
    render();
  }

  function temporaryReveal(set, index, ms = 1500) {
    set.add(index);
    render();
    later(() => {
      set.delete(index);
      render();
    }, ms);
  }

  // While a peek resolves nothing is tappable, so a second tap can't end the turn twice.
  // The turn ends only after the card has flipped back down.
  function playerPeekOwn(index) {
    state.phase = "power-resolving";
    state.playerKnown.add(index);
    record("you", `Peeked at your ${spot("player", index)} card.`);
    say(`Remember ${pretty(state.player[index])}.`);
    temporaryReveal(state.temporaryPlayerReveal, index, 2000);
    later(finishPowerTurn, 2000 + MOVE_MS + 40);
  }

  function playerPeekOpponent(index) {
    state.phase = "power-resolving";
    record("you", `Peeked at the computer's ${spot("ai", index)} card.`);
    say(`Remember their ${pretty(state.ai[index])}.`);
    temporaryReveal(state.temporaryAiReveal, index, 2000);
    later(finishPowerTurn, 2000 + MOVE_MS + 40);
  }

  function playerBlindSwap(aiIndex) {
    record("you", `Blind-swapped your ${spot("player", state.selectedOwn)} card with its ${spot("ai", aiIndex)} card.`);
    swapCards(state.selectedOwn, aiIndex);
    say("Blind swap complete.");
    finishPowerTurn();
  }

  function playerSwapCheck(aiIndex) {
    const ownIndex = state.selectedOwn;
    record("you", `Swapped your ${spot("player", ownIndex)} card with its ${spot("ai", aiIndex)} card and looked at it.`);
    swapCards(ownIndex, aiIndex);
    state.playerKnown.add(ownIndex);
    state.phase = "power-resolving";
    state.selectedOwn = null;
    say("Swapped. Here's what you got…");
    render();
    later(() => {
      say(`You received ${pretty(state.player[ownIndex])}. Remember it.`);
      temporaryReveal(state.temporaryPlayerReveal, ownIndex, 2000);
      later(finishPowerTurn, 2000 + MOVE_MS + 40);
    }, MOVE_MS);
  }

  function playerKingCheck(aiIndex) {
    state.selectedOpp = aiIndex;
    record("you", `Checked the computer's ${spot("ai", aiIndex)} card.`);
    temporaryReveal(state.temporaryAiReveal, aiIndex, 1600);
    state.phase = "power-k-own";
    say(`That's ${pretty(state.ai[aiIndex])}. Now choose one of yours, then decide whether to swap.`);
    render();
  }

  function executeKingSwap() {
    if (state.selectedOwn === null || state.selectedOpp === null) return;
    record("you", `Swapped it with your ${spot("player", state.selectedOwn)} card.`);
    swapCards(state.selectedOwn, state.selectedOpp);
    state.playerKnown.add(state.selectedOwn);
    say("Swap complete.");
    finishPowerTurn();
  }

  function keepHands() {
    record("you", "Kept both hands.");
    finishPowerTurn();
  }

  function finishPowerTurn() {
    state.temporaryPlayerReveal.clear();
    state.temporaryAiReveal.clear();
    state.pendingPower = null;
    state.selectedOwn = null;
    state.selectedOpp = null;
    endPlayerTurn();
  }

  function swapCards(playerIndex, aiIndex) {
    const aiKnewOwn = state.aiKnown.has(aiIndex);
    const aiKnewYours = state.aiKnowsPlayer.has(playerIndex);
    const temp = state.player[playerIndex];
    state.player[playerIndex] = state.ai[aiIndex];
    state.ai[aiIndex] = temp;

    state.playerKnown.delete(playerIndex);
    state.aiKnown.delete(aiIndex);
    state.aiKnowsPlayer.delete(playerIndex);
    // A computer that tracks cards watches which ones moved, so what it knew moves with them.
    if (tracks() && aiKnewOwn) state.aiKnowsPlayer.add(playerIndex);
    if (tracks() && aiKnewYours) state.aiKnown.add(aiIndex);
  }

  function enterMatchMode() {
    if (state.turn !== "player" || state.phase !== "await-draw") return;
    state.phase = "match-mode";
    say("Choose the face-down card you think matches the top discard.");
    render();
  }

  function cancelMatch() {
    state.phase = "await-draw";
    say("Your turn. Draw from the deck, or take the discard.");
    render();
  }

  function skipPower() {
    record("you", "Skipped the power.");
    say("You skipped the power.");
    finishPowerTurn();
  }

  function tryPlayerMatch(index) {
    const top = state.discard[state.discard.length - 1];
    const card = state.player[index];
    const where = spot("player", index);
    if (sameRank(card, top)) {
      record("you", `Matched the discard with your ${where} card, `, card, ".");
      state.discard.push(card);
      state.player[index] = null;
      state.playerKnown.delete(index);
      state.aiKnowsPlayer.delete(index);
      say(`Correct — ${pretty(card)} is gone. Now take your turn.`);
    } else {
      record("you", `Tried to match with your ${where} card, `, card, ". Wrong, so took a penalty card.");
      if (tracks()) state.aiKnowsPlayer.add(index); // the wrong card was shown
      refillDeckIfNeeded();
      placeCard(state.player, state.deck.pop());
      say(`Wrong match. ${pretty(card)} doesn't match ${pretty(top)} — penalty card added.`);
    }
    state.phase = "await-draw";
    render();
  }

  function callCabo() {
    if (state.turn !== "player" || state.phase !== "await-draw" || state.caboCaller) return;
    state.caboCaller = "player";
    state.finalTurnOwner = "ai";
    record("you", "Called Cabo.");
    say("Cabo. Your hand is locked; the computer gets one last turn.");
    state.turn = "ai";
    state.phase = "ai-turn";
    render();
    later(aiTurn, CARD_MOVE_MS + 450);
  }

  function endPlayerTurn() {
    state.playerTurnCount += 1;
    state.drawn = null;
    state.drawnSource = null;
    state.selectedOwn = null;
    state.selectedOpp = null;

    if (state.caboCaller === "ai" && state.finalTurnOwner === "player") return finishGame();

    state.turn = "ai";
    state.phase = "ai-turn";
    render();
    later(aiTurn, CARD_MOVE_MS + 450);
  }

  async function aiTurn() {
    if (state.gameOver) return;

    if (!state.caboCaller && shouldAiCallCabo()) {
      state.caboCaller = "ai";
      state.finalTurnOwner = "player";
      record("computer", "Called Cabo.");
      await step("The computer calls Cabo. You get one final turn.", 1000);
      state.turn = "player";
      state.phase = "await-draw";
      render();
      return;
    }

    const top = state.discard[state.discard.length - 1];
    const matchIndex = [...state.aiKnown].find(i => state.ai[i] && sameRank(state.ai[i], top));
    if (matchIndex !== undefined) {
      const matched = state.ai[matchIndex];
      record("computer", `Matched the discard with its ${spot("ai", matchIndex)} card, `, matched, ".");
      state.discard.push(matched);
      state.ai[matchIndex] = null;
      state.aiKnown.delete(matchIndex);
      await step(`Computer matched the discard with its ${matched.rank}.`, 1000);
    }

    const takeAt = planDiscardTake();

    if (takeAt !== null) {
      state.aiDrawn = state.discard.pop();
      state.aiDrawnShown = true;
      record("computer", "Took ", state.aiDrawn, " from the discard.");
      await step(`Computer takes the ${pretty(state.aiDrawn)}.`, 800);
      aiKeepDrawn(takeAt);
      await step("Computer swapped it into its hand.", 900);
    } else {
      refillDeckIfNeeded();
      state.aiDrawn = state.deck.pop();
      state.aiDrawnShown = false;
      record("computer", "Drew from the deck.");
      await step("Computer draws from the deck.", 900);
      await aiUseDrawnCard(state.aiDrawn);
    }

    state.aiTurnCount += 1;

    if (state.caboCaller === "player" && state.finalTurnOwner === "ai") return finishGame();

    state.turn = "player";
    state.phase = "await-draw";
    say("Your turn. Draw from the deck or the discard.");
    render();
  }

  function desirable(card) {
    return score(card) <= 5 || score(card) <= 0;
  }

  async function aiUseDrawnCard(card) {
    const power = powerFor(card);
    const keepAt = chooseKeepSpot(card, power);

    if (keepAt !== null) {
      aiKeepDrawn(keepAt);
      await step("Computer kept it and threw away one of its cards.", 1000);
      return;
    }

    state.discard.push(card);
    record("computer", "Discarded ", card, ".");
    state.aiDrawn = null;
    if (!power) {
      await step(`Computer discarded the ${pretty(card)}.`, 900);
      return;
    }

    await step(`Computer discarded the ${pretty(card)} to use its power.`, 1000);
    await aiUsePower(power);
  }

  // Each computer move is shown on the table, then held long enough to follow.
  async function step(text, ms) {
    say(text);
    render();
    await pause(ms);
  }

  // The computer lifts a card toward itself while it looks, so you can see which one.
  async function peekStep(key, text) {
    state.lifted.add(key);
    await step(text, 1100);
    state.lifted.delete(key);
    render();
    await pause(MOVE_MS);
  }

  function aiKeepDrawn(index) {
    const old = state.ai[index];
    record("computer", `Put it in its ${spot("ai", index)} spot, discarding `, old, ".");
    state.ai[index] = state.aiDrawn;
    state.aiKnown.add(index);
    state.discard.push(old);
    state.aiDrawn = null;
  }

  async function aiUsePower(power) {
    return smart() ? aiUsePowerSmart(power) : aiUsePowerEasy(power);
  }

  // --- Medium and hard ---------------------------------------------------------

  // Knobs for medium and hard, in card points. take/keep: how much better a card must be
  // before it's swapped in (power: the same, when the drawn card's power could be used
  // instead). lead: how far ahead of you it wants to be to call Cabo, plus risk for each of
  // its own cards it hasn't seen. improve/floor: how much it assumes each of your cards it
  // hasn't seen gets better per turn, down to floor; kept caps a card you've seen and kept.
  // count: work out the unseen average by counting cards instead of assuming 6.2.
  // track: follow cards it knows as they're swapped between hands or taken from the discard.
  const TUNING = {
    medium: { take: 2, keep: 0.5, power: 2, caboTurns: 3, caboLow: 4, lead: 3, risk: 2, improve: 0.6, floor: 1.5, count: false, track: false },
    hard: { take: 2, keep: 0.5, power: 2, caboTurns: 4, caboLow: 4, lead: 4, risk: 2, improve: 0.8, floor: 1.5, kept: 3, count: true, track: true },
  };

  function tune() {
    return TUNING[state.level];
  }

  function tracks() {
    return smart() && tune().track;
  }

  function smart() {
    return state.level !== "easy";
  }

  // After you call Cabo the computer has one turn left, so any gain is worth taking.
  function finalTurn() {
    return state.caboCaller === "player";
  }

  // The average value of the cards the computer hasn't seen. Hard counts cards to work
  // it out; medium assumes an average deck.
  function unseenAverage() {
    if (!tune().count) return 6.2;
    const seen = new Set(state.discard.map((card) => card.id));
    state.aiKnown.forEach((i) => state.ai[i] && seen.add(state.ai[i].id));
    state.aiKnowsPlayer.forEach((i) => state.player[i] && seen.add(state.player[i].id));
    if (state.aiDrawn) seen.add(state.aiDrawn.id);
    const unseen = [...state.deck, ...state.ai, ...state.player].filter((card) => card && !seen.has(card.id));
    return unseen.length ? unseen.reduce((sum, card) => sum + score(card), 0) / unseen.length : 6.2;
  }

  // The computer's weakest spot: its highest known card, or a card it hasn't seen, valued
  // at the unseen average. Known cards win ties, since that gain is certain.
  function worstAiSlot() {
    const avg = unseenAverage();
    let worst = null;
    state.ai.forEach((card, i) => {
      if (!card) return;
      const known = state.aiKnown.has(i);
      const value = known ? score(card) : avg;
      if (!worst || value > worst.value || (value === worst.value && known)) worst = { index: i, value, known };
    });
    return worst;
  }

  function lowestKnownPlayerIndex() {
    const known = [...state.aiKnowsPlayer].filter((i) => state.player[i]);
    if (!known.length) return null;
    return known.reduce((best, i) => (score(state.player[i]) < score(state.player[best]) ? i : best), known[0]);
  }

  // The hand spot the computer would fill with the top discard, or null to draw instead.
  function planDiscardTake() {
    const top = state.discard[state.discard.length - 1];
    if (!top) return null;
    if (!smart()) {
      const high = highestKnownIndex(state.ai, state.aiKnown);
      return high !== null && desirable(top) && score(top) < score(state.ai[high]) ? high : null;
    }
    const worst = worstAiSlot();
    const margin = finalTurn() ? 0.5 : tune().take;
    return worst && worst.value - score(top) >= margin ? worst.index : null;
  }

  // Where the computer would keep a drawn card, or null to discard it (and use any power).
  function chooseKeepSpot(card, power) {
    if (!smart()) {
      const high = highestKnownIndex(state.ai, state.aiKnown);
      return high !== null && score(card) < score(state.ai[high]) && (score(card) <= 6 || !power) ? high : null;
    }
    const worst = worstAiSlot();
    if (!worst) return null;
    const gain = worst.value - score(card);
    if (finalTurn()) return gain > 0 ? worst.index : null;
    // A power is worth something too, so a small gain loses out to using it.
    const needed = power ? tune().power : tune().keep;
    return gain > needed ? worst.index : null;
  }

  // Call Cabo once the hand is low, or clearly lower than the computer's read of yours.
  function smartShouldCallCabo() {
    const t = tune();
    if (state.aiTurnCount < t.caboTurns) return false;
    const avg = unseenAverage();
    const unknownOwn = state.ai.filter((card, i) => card && !state.aiKnown.has(i)).length;
    const own = state.ai.reduce((sum, card, i) => sum + (card ? (state.aiKnown.has(i) ? score(card) : avg) : 0), 0);
    const yours = state.player.reduce((sum, card, i) => sum + (card ? yourSpotValue(i, avg) : 0), 0);
    if (unknownOwn === 0 && own <= t.caboLow) return true;
    if (own + t.lead + t.risk * unknownOwn < yours) return true;
    return state.aiTurnCount >= 10 && own <= 10;
  }

  // What the computer thinks one of your cards is worth. Some it knows outright; the rest it
  // assumes get a little better each turn. Hard also reads your moves: a card you've looked
  // at and kept is probably a low one.
  function yourSpotValue(i, avg) {
    if (state.aiKnowsPlayer.has(i)) return score(state.player[i]);
    const t = tune();
    const guess = Math.max(avg - t.improve * state.playerTurnCount, t.floor);
    return t.kept !== undefined && state.playerKnown.has(i) ? Math.min(guess, t.kept) : guess;
  }

  // Use a power only when it helps, aiming at the cards the computer knows about.
  async function aiUsePowerSmart(power) {
    const pass = async () => {
      record("computer", "Passed on the power.");
      await step("Computer passes on the power.", 800);
    };

    if (power === "peek-own" || power === "peek-opponent") {
      const own = power === "peek-own";
      const known = own ? state.aiKnown : state.aiKnowsPlayer;
      const i = randomFrom(indices(own ? state.ai : state.player).filter((j) => !known.has(j)));
      if (finalTurn() || i === null) return pass(); // no turns left to use what it would learn
      known.add(i);
      record("computer", own ? `Peeked at its ${spot("ai", i)} card.` : `Peeked at your ${spot("player", i)} card.`);
      await peekStep(`${own ? "ai" : "player"}:${i}`, own ? "Computer peeks at one of its cards." : "Computer peeks at one of your cards.");
      return;
    }

    const worst = worstAiSlot();
    if (!worst) return pass();

    if (power === "check-swap") {
      // Look at one of your cards it hasn't seen (or your best known one), then swap only if it's better.
      const unseen = indices(state.player).filter((j) => !state.aiKnowsPlayer.has(j));
      const opp = unseen.length ? randomFrom(unseen) : lowestKnownPlayerIndex();
      if (opp === null) return pass();
      state.aiKnowsPlayer.add(opp);
      record("computer", `Checked your ${spot("player", opp)} card.`);
      await peekStep(`player:${opp}`, "Computer checks one of your cards…");
      if (worst.value - score(state.player[opp]) > (finalTurn() ? 0 : 1)) {
        record("computer", `Swapped it with its ${spot("ai", worst.index)} card.`);
        aiSwap(worst.index, opp, true);
        await step("…and swaps it for one of its own.", 1000);
      } else {
        record("computer", "Left it.");
        await step("…and leaves it.", 800);
      }
      return;
    }

    // Jack or queen: trade its weakest card for your best card it knows about, or, when its
    // weakest card is bad enough, gamble on one of yours it hasn't seen.
    let opp = lowestKnownPlayerIndex();
    if (opp === null || worst.value - score(state.player[opp]) < 2) {
      const unseen = indices(state.player).filter((j) => !state.aiKnowsPlayer.has(j));
      opp = worst.known && worst.value - unseenAverage() >= 3 ? randomFrom(unseen) : null;
    }
    if (opp === null) return pass();

    if (power === "blind-swap") {
      record("computer", `Blind-swapped its ${spot("ai", worst.index)} card with your ${spot("player", opp)} card.`);
      aiSwap(worst.index, opp, false);
      await step("Computer swaps one of its cards with one of yours, blind.", 1000);
    } else {
      record("computer", `Swapped its ${spot("ai", worst.index)} card with your ${spot("player", opp)} card and looked at it.`);
      aiSwap(worst.index, opp, true);
      await step("Computer swaps a card with one of yours…", 900);
      await peekStep(`ai:${worst.index}`, "…and checks what it got.");
    }
  }

  // --- Easy: the original computer --------------------------------------------

  async function aiUsePowerEasy(power) {
    if (power === "peek-own") {
      const unknown = indices(state.ai).filter(i => !state.aiKnown.has(i));
      const i = randomFrom(unknown.length ? unknown : indices(state.ai));
      if (i !== null) {
        state.aiKnown.add(i);
        record("computer", `Peeked at its ${spot("ai", i)} card.`);
      }
      await peekStep(`ai:${i}`, "Computer peeks at one of its cards.");
      return;
    }

    if (power === "peek-opponent") {
      const unknown = indices(state.player).filter(i => !state.aiKnowsPlayer.has(i));
      const i = randomFrom(unknown.length ? unknown : indices(state.player));
      if (i !== null) {
        state.aiKnowsPlayer.add(i);
        record("computer", `Peeked at your ${spot("player", i)} card.`);
      }
      await peekStep(`player:${i}`, "Computer peeks at one of your cards.");
      return;
    }

    if (power === "blind-swap") {
      const own = highestKnownIndex(state.ai, state.aiKnown) ?? randomFrom(indices(state.ai));
      const opp = randomFrom(indices(state.player));
      if (own !== null && opp !== null) {
        record("computer", `Blind-swapped its ${spot("ai", own)} card with your ${spot("player", opp)} card.`);
        aiSwap(own, opp, false);
      }
      await step("Computer swaps one of its cards with one of yours, blind.", 1000);
      return;
    }

    if (power === "swap-check") {
      const own = highestKnownIndex(state.ai, state.aiKnown) ?? randomFrom(indices(state.ai));
      const opp = choosePlayerCardForAiSwap();
      if (own !== null && opp !== null) {
        record("computer", `Swapped its ${spot("ai", own)} card with your ${spot("player", opp)} card and looked at it.`);
        aiSwap(own, opp, true);
        await step("Computer swaps a card with one of yours…", 900);
        await peekStep(`ai:${own}`, "…and checks what it got.");
      }
      return;
    }

    if (power === "check-swap") {
      const opp = choosePlayerCardToInspect();
      if (opp === null) return;
      state.aiKnowsPlayer.add(opp);
      record("computer", `Checked your ${spot("player", opp)} card.`);
      await peekStep(`player:${opp}`, "Computer checks one of your cards…");
      const own = highestKnownIndex(state.ai, state.aiKnown);
      if (own !== null && score(state.player[opp]) < score(state.ai[own])) {
        record("computer", `Swapped it with its ${spot("ai", own)} card.`);
        aiSwap(own, opp, true);
        await step("…and swaps it for one of its own.", 1000);
      } else {
        record("computer", "Left it.");
        await step("…and leaves it.", 800);
      }
    }
  }

  function aiSwap(aiIndex, playerIndex, knowsReceived) {
    const knewOwn = state.aiKnown.has(aiIndex);
    const knewYours = state.aiKnowsPlayer.has(playerIndex);
    const temp = state.ai[aiIndex];
    state.ai[aiIndex] = state.player[playerIndex];
    state.player[playerIndex] = temp;
    state.aiKnown.delete(aiIndex);
    state.playerKnown.delete(playerIndex);
    state.aiKnowsPlayer.delete(playerIndex);
    if (knowsReceived || (tracks() && knewYours)) state.aiKnown.add(aiIndex);
    if (tracks() && knewOwn) state.aiKnowsPlayer.add(playerIndex);
  }

  function choosePlayerCardForAiSwap() {
    const known = [...state.aiKnowsPlayer].filter(i => state.player[i]);
    if (known.length) {
      known.sort((a, b) => score(state.player[a]) - score(state.player[b]));
      return known[0];
    }
    return randomFrom(indices(state.player));
  }

  function choosePlayerCardToInspect() {
    const unknown = indices(state.player).filter(i => !state.aiKnowsPlayer.has(i));
    return randomFrom(unknown.length ? unknown : indices(state.player));
  }

  function highestKnownIndex(hand, knownSet) {
    const valid = [...knownSet].filter(i => hand[i]);
    if (!valid.length) return null;
    return valid.reduce((best, i) => score(hand[i]) > score(hand[best]) ? i : best, valid[0]);
  }

  function estimateAiScore() {
    let total = 0;
    state.ai.forEach((card, i) => {
      if (!card) return;
      total += state.aiKnown.has(i) ? score(card) : 6.5;
    });
    return total;
  }

  function shouldAiCallCabo() {
    if (smart()) return smartShouldCallCabo();
    if (state.aiTurnCount < 4) return false;
    const estimate = estimateAiScore();
    if (estimate <= 7) return true;
    if (state.aiTurnCount >= 8 && estimate <= 10) return Math.random() < 0.6;
    if (state.aiTurnCount >= 12) return Math.random() < 0.35;
    return false;
  }

  // The round ends on the table rather than behind a dialog: every card turns over where
  // it lies, then each hand is counted one card at a time with the total ticking up beside it.
  function finishGame() {
    state.gameOver = true;
    state.phase = "counting";
    state.temporaryPlayerReveal.clear();
    state.temporaryAiReveal.clear();
    state.scores = {
      player: state.player.reduce((sum, c) => sum + (c ? score(c) : 0), 0),
      ai: state.ai.reduce((sum, c) => sum + (c ? score(c) : 0), 0),
    };
    say("Hands are down. Counting them up…");
    render();
    countUp();
  }

  async function countUp() {
    showTally(els.playerTally, "you");
    showTally(els.aiTally, "computer");
    const complete = await runScoreCount({
      hands: [
        { owner: "player", cards: state.player, container: els.playerHand, tally: els.playerTally },
        { owner: "ai", cards: state.ai, container: els.aiHand, tally: els.aiTally },
      ],
      shouldContinue: () => state.phase === "counting",
      onHandStart: ({ container, tally }) => {
        container.classList.add("tallying");
        tally.classList.add("active");
      },
      onCard: ({ owner, container, tally }, card, index) => {
        const value = score(card);
        const running = (Number(tally.querySelector(".tally-total").textContent) || 0) + value;
        state.counted[owner] = index + 1;
        revealScoreCard(container.children[index], value);
        setTally(tally, running);
      },
      onHandEnd: ({ container, tally }) => {
        container.classList.remove("tallying");
        tally.classList.remove("active");
      },
    });
    if (complete) settleCount();
  }

  function setTally(tally, value) {
    setTallyValue(tally, value);
  }

  function showTally(tally, name) {
    tally.querySelector(".tally-name").textContent = name;
    tally.querySelector(".tally-total").textContent = "0";
    tally.classList.remove("active", "winner");
    tally.hidden = false;
  }

  // Both totals land, the winner is marked, and the table stays exactly as it is.
  function settleCount() {
    if (state.phase !== "counting") return;
    state.phase = "game-over";
    const { player: p, ai: a } = state.scores;

    for (const [owner, container, tally, total] of [
      ["player", els.playerHand, els.playerTally, p],
      ["ai", els.aiHand, els.aiTally, a],
    ]) {
      const hand = owner === "player" ? state.player : state.ai;
      state.counted[owner] = hand.length;
      container.classList.remove("tallying");
      [...container.children].forEach((card, i) => {
        card.classList.remove("counting");
        card.classList.add("counted");
        if (hand[i] && !card.querySelector(".card-value")) card.appendChild(scoreValueBadge(score(hand[i])));
      });
      tally.classList.remove("active");
      setTally(tally, total);
    }
    els.playerTally.classList.toggle("winner", p < a);
    els.aiTally.classList.toggle("winner", a < p);

    els.resultLine.textContent = p < a ? "you win" : p > a ? "computer wins" : "tie game";
    els.resultLine.hidden = false;
    say(`You ${p}, computer ${a}. ${state.caboCaller === "player" ? "You called cabo." : "The computer called cabo."}`);
    record("round", `Final scores: you ${p}, computer ${a}.`);
    renderHistory();
    renderDock();
  }

  function clearCountUp() {
    els.resultLine.hidden = true;
    els.resultLine.textContent = "";
    for (const tally of [els.playerTally, els.aiTally]) {
      tally.hidden = true;
      tally.classList.remove("active", "winner");
    }
    for (const container of [els.playerHand, els.aiHand]) container.classList.remove("tallying");
  }

  function pretty(card) {
    if (!card) return "card";
    if (card.rank === "JOKER") return "Joker";
    return `${card.rank}${card.suit}`;
  }

  // Spots that still hold a card; an emptied spot is never a choice.
  function indices(arr) {
    return arr.flatMap((card, i) => (card ? [i] : []));
  }

  function randomFrom(arr) {
    if (!arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Timers belong to the game that set them: if a new game starts meanwhile, they never fire.
  function later(fn, ms) {
    const game = state;
    setTimeout(() => { if (state === game) fn(); }, ms);
  }

  function pause(ms) {
    return new Promise(resolve => later(resolve, ms));
  }

  // Appearance follows the system unless settings pick light or dark; the choice is remembered.
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

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

  // Tint the browser's own toolbar to match.
  function updateThemeColor() {
    const setting = themeSetting();
    const dark = setting === "dark" || (setting === "system" && darkQuery.matches);
    els.themeColor.content = dark ? "#161614" : "#f4f0e7";
  }

  darkQuery.addEventListener("change", updateThemeColor);
  updateThemeColor();

  els.deck.addEventListener("click", drawFromDeck);
  els.discard.addEventListener("click", drawFromDiscard);
  els.rulesBtn.addEventListener("click", () => els.rulesDialog.showModal());
  els.closeRulesBtn.addEventListener("click", () => els.rulesDialog.close());
  els.historyBtn.addEventListener("click", () => els.historyDialog.showModal());
  els.closeHistoryBtn.addEventListener("click", () => els.historyDialog.close());
  // Settings: the computer's level (used from the next game) and the appearance (used now).
  function openSettings() {
    for (const radio of els.levelRadios) radio.checked = radio.value === level;
    for (const radio of els.themeRadios) radio.checked = radio.value === themeSetting();
    updateLevelNote();
    els.settingsDialog.showModal();
  }

  function updateLevelNote() {
    els.levelPending.hidden = level === state.level || state.gameOver;
    els.levelPendingText.textContent = `This game stays on ${state.level}.`;
  }

  for (const radio of els.levelRadios) {
    radio.addEventListener("change", () => {
      level = radio.value;
      try { localStorage.setItem("level", level); } catch {}
      updateLevelNote();
    });
  }
  for (const radio of els.themeRadios) radio.addEventListener("change", () => applyTheme(radio.value));

  els.settingsBtn.addEventListener("click", openSettings);
  els.closeSettingsBtn.addEventListener("click", () => els.settingsDialog.close());
  els.newGameNowBtn.addEventListener("click", () => {
    els.settingsDialog.close();
    startGame();
  });
  els.newGameBtn.addEventListener("click", startGame);

  startGame();
})();
