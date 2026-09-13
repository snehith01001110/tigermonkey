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
    rulesBtn: document.getElementById("rulesBtn"),
    closeRulesBtn: document.getElementById("closeRulesBtn"),
    rulesDialog: document.getElementById("rulesDialog"),
    resultDialog: document.getElementById("resultDialog"),
    resultTitle: document.getElementById("resultTitle"),
    resultEyebrow: document.getElementById("resultEyebrow"),
    playerScore: document.getElementById("playerScore"),
    aiScore: document.getElementById("aiScore"),
    playAgainBtn: document.getElementById("playAgainBtn"),
    newGameBtn: document.getElementById("newGameBtn"),
  };

  let state;

  const MOVE_MS = 460;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const POWER_LABELS = {
    "peek-own": "peek yours",
    "peek-opponent": "peek theirs",
    "blind-swap": "blind swap",
    "swap-check": "swap, then check",
    "check-swap": "check, then swap",
  };

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
      caboCaller: null,
      finalTurnOwner: null,
      gameOver: false,
      log: [],
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
    animateCards(before);
  }

  function snapshotCards() {
    const snap = new Map();
    for (const el of document.querySelectorAll(".card[data-card-id]")) {
      snap.set(el.dataset.cardId, {
        rect: el.getBoundingClientRect(),
        width: el.offsetWidth,
        faceUp: el.classList.contains("face-up"),
      });
    }
    return snap;
  }

  // Every render rebuilds the cards from state (FLIP): slide each card from where it
  // was — or from the deck, if it just appeared — to where it is now, flipping it
  // over if its face changed. New cards are dealt one after another.
  function animateCards(before) {
    if (reduceMotion.matches) return;
    const deckRect = (els.deckStack.lastElementChild || els.deck).getBoundingClientRect();
    const fromDeck = { rect: deckRect, width: deckRect.width, faceUp: false };
    const dealt = [];

    for (const el of document.querySelectorAll(".card[data-card-id]")) {
      const prev = before.get(el.dataset.cardId);
      if (prev) animateCard(el, prev, 0);
      else if (!el.dataset.under) dealt.push(el); // uncovered discards were already there
    }
    dealt
      .sort((a, b) => Number(a.dataset.deal || 0) - Number(b.dataset.deal || 0))
      .forEach((el, i) => animateCard(el, fromDeck, i * 90));
  }

  function animateCard(el, from, delay) {
    const to = el.getBoundingClientRect();
    const dx = from.rect.left + from.rect.width / 2 - (to.left + to.width / 2);
    const dy = from.rect.top + from.rect.height / 2 - (to.top + to.height / 2);
    const scale = from.width / el.offsetWidth;
    const timing = { duration: MOVE_MS, delay, easing: "cubic-bezier(.2, .75, .25, 1)", fill: "backwards" };

    if (Math.abs(dx) + Math.abs(dy) > 1 || Math.abs(scale - 1) > 0.01) {
      el.style.zIndex = "10";
      const lift = ((scale + 1) / 2) * 1.06;
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
          { transform: `translate(${dx / 2}px, ${dy / 2}px) scale(${lift})`, offset: 0.5 },
          { transform: "translate(0, 0) scale(1)" },
        ],
        { ...timing, composite: "add" },
      ).finished.then(() => { el.style.zIndex = ""; }, () => {});
    }

    const faceUp = el.classList.contains("face-up");
    if (faceUp !== from.faceUp) {
      el.querySelector(".card-inner").animate(
        [{ transform: `rotateY(${from.faceUp ? 180 : 0}deg)` }, { transform: `rotateY(${faceUp ? 180 : 0}deg)` }],
        timing,
      );
    }
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
      const faceUp = state.gameOver || reveal.has(index);
      const el = cardElement(card, { faceUp, index, owner, selectable: canSelectCard(owner, index) });
      el.dataset.deal = String(index * 2 + (owner === "ai" ? 1 : 0));
      if (selected === index) el.classList.add("selected");
      if (state.lifted.has(`${owner}:${index}`)) el.classList.add("lifted");
      el.addEventListener("click", () => handleCardClick(owner, index));
      container.appendChild(el);
    });
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

    els.actions.innerHTML = "";
    for (const [label, fn, primary] of availableActions()) {
      els.actions.appendChild(actionButton(label, primary ? "primary-button" : "secondary-button", fn));
    }
  }

  function turnLabel() {
    if (state.gameOver) return "round over";
    if (state.phase === "dealing") return "dealing";
    if (state.turn === "ai") return "computer's turn";
    return state.caboCaller === "ai" ? "your final turn" : "your turn";
  }

  // The dock only offers what makes sense right now; drawing is done by tapping the piles.
  function availableActions() {
    if (state.gameOver) return [["play again", startGame, true]];
    if (state.turn !== "player") return [];
    switch (state.phase) {
      case "initial-peek":
        return [["got it", finishInitialPeek, true]];
      case "await-draw": {
        const actions = [];
        if (state.player.length) actions.push(["match discard", enterMatchMode]);
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
        return [["keep hands", finishPowerTurn], ["swap", executeKingSwap, true]];
      default:
        return state.phase.startsWith("power-") && state.phase !== "power-resolving" ? [["skip", skipPower]] : [];
    }
  }

  function say(text) {
    els.message.textContent = text;
  }

  function canSelectCard(owner, index) {
    if (state.gameOver || state.turn !== "player") return false;
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
    if (els.resultDialog.open) els.resultDialog.close();
    state = freshState();
    // Clear the old table so the new hands are dealt from the deck, not slid over.
    for (const el of [els.aiHand, els.playerHand, els.held, els.discard]) el.innerHTML = "";
    say("Dealing…");
    render();
    later(() => {
      state.temporaryPlayerReveal = new Set([2, 3]);
      state.phase = "initial-peek";
      say("Memorize your bottom two cards, then press got it.");
      render();
    }, 1300);
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
    say(`You drew ${pretty(state.drawn)}. Tap one of your cards to swap it in, or discard it${powerFor(state.drawn) ? " to use its power" : ""}.`);
    render();
  }

  function drawFromDiscard() {
    if (state.turn !== "player" || state.phase !== "await-draw") return;
    if (!state.discard.length) return;
    state.drawn = state.discard.pop();
    state.drawnSource = "discard";
    state.phase = "choose-replace";
    say(`You took ${pretty(state.drawn)}. Tap one of your cards to swap it in.`);
    render();
  }

  function replaceWithDrawn(index) {
    const old = state.player[index];
    state.player[index] = state.drawn;
    state.discard.push(old);
    state.playerKnown.add(index);
    state.drawn = null;
    state.drawnSource = null;
    say(`You replaced a card and discarded ${pretty(old)}.`);
    endPlayerTurn();
  }

  function playerDiscardDrawn() {
    if (!state.drawn || state.drawnSource !== "deck") return;
    const card = state.drawn;
    state.discard.push(card);
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
    say(`Remember ${pretty(state.player[index])}.`);
    temporaryReveal(state.temporaryPlayerReveal, index, 2000);
    later(finishPowerTurn, 2000 + MOVE_MS + 40);
  }

  function playerPeekOpponent(index) {
    state.phase = "power-resolving";
    say(`Remember their ${pretty(state.ai[index])}.`);
    temporaryReveal(state.temporaryAiReveal, index, 2000);
    later(finishPowerTurn, 2000 + MOVE_MS + 40);
  }

  function playerBlindSwap(aiIndex) {
    swapCards(state.selectedOwn, aiIndex);
    say("Blind swap complete.");
    finishPowerTurn();
  }

  function playerSwapCheck(aiIndex) {
    const ownIndex = state.selectedOwn;
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
    temporaryReveal(state.temporaryAiReveal, aiIndex, 1600);
    state.phase = "power-k-own";
    say(`That's ${pretty(state.ai[aiIndex])}. Now choose one of yours, then decide whether to swap.`);
    render();
  }

  function executeKingSwap() {
    if (state.selectedOwn === null || state.selectedOpp === null) return;
    swapCards(state.selectedOwn, state.selectedOpp);
    state.playerKnown.add(state.selectedOwn);
    say("Swap complete.");
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
    const temp = state.player[playerIndex];
    state.player[playerIndex] = state.ai[aiIndex];
    state.ai[aiIndex] = temp;

    state.playerKnown.delete(playerIndex);
    state.aiKnown.delete(aiIndex);
    state.aiKnowsPlayer.delete(playerIndex);
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
    say("You skipped the power.");
    finishPowerTurn();
  }

  function tryPlayerMatch(index) {
    const top = state.discard[state.discard.length - 1];
    const card = state.player[index];
    if (sameRank(card, top)) {
      state.discard.push(card);
      state.player.splice(index, 1);
      remapKnowledgeAfterRemoval(state.playerKnown, index);
      remapKnowledgeAfterRemoval(state.aiKnowsPlayer, index);
      say(`Correct — ${pretty(card)} is gone. Now take your turn.`);
    } else {
      refillDeckIfNeeded();
      state.player.push(state.deck.pop());
      say(`Wrong match. ${pretty(card)} doesn't match ${pretty(top)} — penalty card added.`);
    }
    state.phase = "await-draw";
    render();
  }

  function remapKnowledgeAfterRemoval(set, removedIndex) {
    const next = new Set();
    for (const i of set) {
      if (i < removedIndex) next.add(i);
      else if (i > removedIndex) next.add(i - 1);
    }
    set.clear();
    for (const i of next) set.add(i);
  }

  function callCabo() {
    if (state.turn !== "player" || state.phase !== "await-draw" || state.caboCaller) return;
    state.caboCaller = "player";
    state.finalTurnOwner = "ai";
    say("Cabo. Your hand is locked; the computer gets one last turn.");
    state.turn = "ai";
    state.phase = "ai-turn";
    render();
    later(aiTurn, 750);
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
    later(aiTurn, 700);
  }

  async function aiTurn() {
    if (state.gameOver) return;

    if (!state.caboCaller && shouldAiCallCabo()) {
      state.caboCaller = "ai";
      state.finalTurnOwner = "player";
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
      state.discard.push(matched);
      state.ai.splice(matchIndex, 1);
      remapKnowledgeAfterRemoval(state.aiKnown, matchIndex);
      await step(`Computer matched the discard with its ${matched.rank}.`, 1000);
    }

    const knownHighest = highestKnownIndex(state.ai, state.aiKnown);
    const discardTop = state.discard[state.discard.length - 1];
    const takeDiscard = discardTop && knownHighest !== null && desirable(discardTop) && score(discardTop) < score(state.ai[knownHighest]);

    if (takeDiscard) {
      state.aiDrawn = state.discard.pop();
      state.aiDrawnShown = true;
      await step(`Computer takes the ${pretty(state.aiDrawn)}.`, 800);
      aiKeepDrawn(knownHighest);
      await step("Computer swapped it into its hand.", 900);
    } else {
      refillDeckIfNeeded();
      state.aiDrawn = state.deck.pop();
      state.aiDrawnShown = false;
      await step("Computer draws from the deck.", 900);
      await aiUseDrawnCard(state.aiDrawn);
    }

    state.aiTurnCount += 1;

    if (state.caboCaller === "player" && state.finalTurnOwner === "ai") return finishGame();

    state.turn = "player";
    state.phase = "await-draw";
    say("Your turn. Tap the deck or the discard to draw.");
    render();
  }

  function desirable(card) {
    return score(card) <= 5 || score(card) <= 0;
  }

  async function aiUseDrawnCard(card) {
    const highIndex = highestKnownIndex(state.ai, state.aiKnown);
    const power = powerFor(card);
    const shouldKeep = highIndex !== null && score(card) < score(state.ai[highIndex]) && (score(card) <= 6 || !power);

    if (shouldKeep) {
      aiKeepDrawn(highIndex);
      await step("Computer kept it and threw away one of its cards.", 1000);
      return;
    }

    state.discard.push(card);
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
    state.ai[index] = state.aiDrawn;
    state.aiKnown.add(index);
    state.discard.push(old);
    state.aiDrawn = null;
  }

  async function aiUsePower(power) {
    if (power === "peek-own") {
      const unknown = indices(state.ai).filter(i => !state.aiKnown.has(i));
      const i = randomFrom(unknown.length ? unknown : indices(state.ai));
      if (i !== null) state.aiKnown.add(i);
      await peekStep(`ai:${i}`, "Computer peeks at one of its cards.");
      return;
    }

    if (power === "peek-opponent") {
      const unknown = indices(state.player).filter(i => !state.aiKnowsPlayer.has(i));
      const i = randomFrom(unknown.length ? unknown : indices(state.player));
      if (i !== null) state.aiKnowsPlayer.add(i);
      await peekStep(`player:${i}`, "Computer peeks at one of your cards.");
      return;
    }

    if (power === "blind-swap") {
      const own = highestKnownIndex(state.ai, state.aiKnown) ?? randomFrom(indices(state.ai));
      const opp = randomFrom(indices(state.player));
      if (own !== null && opp !== null) aiSwap(own, opp, false);
      await step("Computer swaps one of its cards with one of yours, blind.", 1000);
      return;
    }

    if (power === "swap-check") {
      const own = highestKnownIndex(state.ai, state.aiKnown) ?? randomFrom(indices(state.ai));
      const opp = choosePlayerCardForAiSwap();
      if (own !== null && opp !== null) {
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
      await peekStep(`player:${opp}`, "Computer checks one of your cards…");
      const own = highestKnownIndex(state.ai, state.aiKnown);
      if (own !== null && score(state.player[opp]) < score(state.ai[own])) {
        aiSwap(own, opp, true);
        await step("…and swaps it for one of its own.", 1000);
      } else {
        await step("…and leaves it.", 800);
      }
    }
  }

  function aiSwap(aiIndex, playerIndex, knowsReceived) {
    const temp = state.ai[aiIndex];
    state.ai[aiIndex] = state.player[playerIndex];
    state.player[playerIndex] = temp;
    state.aiKnown.delete(aiIndex);
    state.playerKnown.delete(playerIndex);
    state.aiKnowsPlayer.delete(playerIndex);
    if (knowsReceived) state.aiKnown.add(aiIndex);
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
    if (!state.ai.length) return 0;
    let total = 0;
    state.ai.forEach((card, i) => {
      total += state.aiKnown.has(i) ? score(card) : 6.5;
    });
    return total;
  }

  function shouldAiCallCabo() {
    if (state.aiTurnCount < 4) return false;
    const estimate = estimateAiScore();
    if (estimate <= 7) return true;
    if (state.aiTurnCount >= 8 && estimate <= 10) return Math.random() < 0.6;
    if (state.aiTurnCount >= 12) return Math.random() < 0.35;
    return false;
  }

  function finishGame() {
    state.gameOver = true;
    state.phase = "game-over";
    state.temporaryPlayerReveal.clear();
    state.temporaryAiReveal.clear();
    render();

    const p = state.player.reduce((sum, c) => sum + score(c), 0);
    const a = state.ai.reduce((sum, c) => sum + score(c), 0);
    els.playerScore.textContent = String(p);
    els.aiScore.textContent = String(a);
    els.resultEyebrow.textContent = state.caboCaller === "player" ? "you called cabo" : "computer called cabo";
    els.resultTitle.textContent = p < a ? "you win" : p > a ? "computer wins" : "tie game";
    later(() => els.resultDialog.showModal(), 1200);
  }

  function pretty(card) {
    if (!card) return "card";
    if (card.rank === "JOKER") return "Joker";
    return `${card.rank}${card.suit}`;
  }

  function indices(arr) {
    return arr.map((_, i) => i);
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

  els.deck.addEventListener("click", drawFromDeck);
  els.discard.addEventListener("click", drawFromDiscard);
  els.rulesBtn.addEventListener("click", () => els.rulesDialog.showModal());
  els.closeRulesBtn.addEventListener("click", () => els.rulesDialog.close());
  els.playAgainBtn.addEventListener("click", () => { els.resultDialog.close(); startGame(); });
  els.newGameBtn.addEventListener("click", () => { if (els.resultDialog.open) els.resultDialog.close(); startGame(); });

  startGame();
})();
