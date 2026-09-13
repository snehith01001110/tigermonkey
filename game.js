(() => {
  const SUITS = ["♠", "♥", "♦", "♣"];
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

  const els = {
    aiHand: document.getElementById("aiHand"),
    playerHand: document.getElementById("playerHand"),
    aiStatus: document.getElementById("aiStatus"),
    playerStatus: document.getElementById("playerStatus"),
    deck: document.getElementById("deck"),
    discard: document.getElementById("discard"),
    message: document.getElementById("message"),
    drawnArea: document.getElementById("drawnArea"),
    drawnCard: document.getElementById("drawnCard"),
    drawActions: document.getElementById("drawActions"),
    matchBtn: document.getElementById("matchBtn"),
    caboBtn: document.getElementById("caboBtn"),
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
      phase: "initial-peek",
      drawn: null,
      drawnSource: null,
      selectedOwn: null,
      selectedOpp: null,
      pendingPower: null,
      playerTurnCount: 0,
      aiTurnCount: 0,
      playerKnown: new Set([2, 3]),
      aiKnown: new Set([2, 3]),
      aiKnowsPlayer: new Set(),
      temporaryPlayerReveal: new Set([2, 3]),
      temporaryAiReveal: new Set(),
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
    if (index !== null) button.dataset.index = String(index);
    if (owner) button.dataset.owner = owner;

    if (faceUp) {
      const red = card.suit === "♥" || card.suit === "♦";
      if (red) button.classList.add("red");
      const label = card.rank === "JOKER" ? "★" : card.rank;
      const suit = card.rank === "JOKER" ? "" : card.suit;
      button.innerHTML = `
        <div class="card-corner"><span>${label}</span><span class="card-suit">${suit}</span></div>
        <div class="card-center">${card.rank === "JOKER" ? "★" : suit}</div>
        <div class="card-corner bottom"><span>${label}</span><span class="card-suit">${suit}</span></div>`;
    }
    return button;
  }

  function render() {
    renderHands();
    renderDiscard();
    renderDrawn();
    updateControls();
  }

  function renderHands() {
    els.playerHand.innerHTML = "";
    state.player.forEach((card, index) => {
      const faceUp = state.gameOver || state.temporaryPlayerReveal.has(index);
      const selectable = canSelectCard("player", index);
      const el = cardElement(card, { faceUp, index, owner: "player", selectable });
      if (state.selectedOwn === index) el.classList.add("selected");
      el.addEventListener("click", () => handleCardClick("player", index));
      els.playerHand.appendChild(el);
    });

    els.aiHand.innerHTML = "";
    state.ai.forEach((card, index) => {
      const faceUp = state.gameOver || state.temporaryAiReveal.has(index);
      const selectable = canSelectCard("ai", index);
      const el = cardElement(card, { faceUp, index, owner: "ai", selectable });
      if (state.selectedOpp === index) el.classList.add("selected");
      el.addEventListener("click", () => handleCardClick("ai", index));
      els.aiHand.appendChild(el);
    });
  }

  function renderDiscard() {
    els.discard.innerHTML = "";
    const top = state.discard[state.discard.length - 1];
    if (top) {
      const card = cardElement(top, { faceUp: true });
      card.disabled = true;
      els.discard.appendChild(card);
    }
    const label = document.createElement("span");
    label.className = "pile-label";
    label.textContent = "discard";
    els.discard.appendChild(label);
  }

  function renderDrawn() {
    if (!state.drawn || state.turn !== "player") {
      els.drawnArea.classList.add("hidden");
      els.drawnCard.innerHTML = "";
      els.drawActions.innerHTML = "";
      return;
    }

    els.drawnArea.classList.remove("hidden");
    els.drawnCard.innerHTML = "";
    const drawn = cardElement(state.drawn, { faceUp: true });
    drawn.disabled = true;
    els.drawnCard.appendChild(drawn);
    els.drawActions.innerHTML = "";

    if (state.phase === "drawn") {
      const swap = actionButton("replace a card", "secondary-button", () => {
        state.phase = "choose-replace";
        say("Choose one of your cards to replace.");
        render();
      });
      els.drawActions.appendChild(swap);

      if (state.drawnSource === "deck") {
        const discard = actionButton("discard", "secondary-button", playerDiscardDrawn);
        els.drawActions.appendChild(discard);
      }
    }

    if (state.phase === "king-swap-choice") {
      els.drawActions.appendChild(actionButton("swap", "secondary-button", executeKingSwap));
      els.drawActions.appendChild(actionButton("keep hands", "secondary-button", finishPowerTurn));
    }
  }

  function actionButton(label, className, fn) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  }

  function updateControls() {
    const yourTurn = state.turn === "player" && !state.gameOver;
    const neutralPhase = state.phase === "await-draw";
    els.deck.disabled = !(yourTurn && neutralPhase);
    els.matchBtn.disabled = !(yourTurn && neutralPhase && state.player.length > 0 && state.discard.length > 0);
    els.caboBtn.disabled = !(yourTurn && neutralPhase && !state.caboCaller);

    els.playerStatus.textContent = state.gameOver ? "revealed" : state.turn === "player" ? "your turn" : "waiting";
    els.aiStatus.textContent = state.gameOver ? "revealed" : state.turn === "ai" ? "thinking" : "waiting";
  }

  function say(text) {
    els.message.textContent = text;
  }

  function canSelectCard(owner, index) {
    if (state.gameOver || state.turn !== "player") return false;
    if (owner === "player") {
      return ["choose-replace", "match-mode", "power-peek-own", "power-j-own", "power-q-own", "power-k-own"].includes(state.phase);
    }
    return ["power-peek-opponent", "power-j-opponent", "power-q-opponent", "power-k-check-opponent"].includes(state.phase);
  }

  function handleCardClick(owner, index) {
    if (!canSelectCard(owner, index)) return;

    if (owner === "player") {
      if (state.phase === "choose-replace") return replaceWithDrawn(index);
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
    say("Look at your bottom two cards.");
    render();
    setTimeout(() => {
      if (state.phase !== "initial-peek") return;
      state.temporaryPlayerReveal.clear();
      state.phase = "await-draw";
      say("Your turn. Draw from the deck, or take the discard.");
      render();
    }, 2200);
  }

  function drawFromDeck() {
    if (state.turn !== "player" || state.phase !== "await-draw") return;
    refillDeckIfNeeded();
    state.drawn = state.deck.pop();
    state.drawnSource = "deck";
    state.phase = "drawn";
    say(`You drew ${pretty(state.drawn)}. Keep it or discard it${powerFor(state.drawn) ? " to use its power" : ""}.`);
    render();
  }

  function drawFromDiscard() {
    if (state.turn !== "player" || state.phase !== "await-draw") return;
    if (!state.discard.length) return;
    state.drawn = state.discard.pop();
    state.drawnSource = "discard";
    state.phase = "choose-replace";
    say(`You took ${pretty(state.drawn)}. Choose one of your cards to replace.`);
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
    setTimeout(() => {
      set.delete(index);
      render();
    }, ms);
  }

  function playerPeekOwn(index) {
    state.playerKnown.add(index);
    temporaryReveal(state.temporaryPlayerReveal, index, 1600);
    say(`Remember ${pretty(state.player[index])}.`);
    setTimeout(finishPowerTurn, 1650);
  }

  function playerPeekOpponent(index) {
    temporaryReveal(state.temporaryAiReveal, index, 1600);
    say(`Remember their ${pretty(state.ai[index])}.`);
    setTimeout(finishPowerTurn, 1650);
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
    temporaryReveal(state.temporaryPlayerReveal, ownIndex, 1600);
    say(`You received ${pretty(state.player[ownIndex])}. Remember it.`);
    setTimeout(finishPowerTurn, 1650);
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
    setTimeout(aiTurn, 750);
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
    setTimeout(aiTurn, 700);
  }

  async function aiTurn() {
    if (state.gameOver) return;

    if (!state.caboCaller && shouldAiCallCabo()) {
      state.caboCaller = "ai";
      state.finalTurnOwner = "player";
      say("The computer calls Cabo. You get one final turn.");
      await pause(800);
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
      say(`Computer matched the discard and got rid of a ${matched.rank}.`);
      await pause(650);
    }

    const knownHighest = highestKnownIndex(state.ai, state.aiKnown);
    const discardTop = state.discard[state.discard.length - 1];
    const takeDiscard = discardTop && knownHighest !== null && desirable(discardTop) && score(discardTop) < score(state.ai[knownHighest]);

    if (takeDiscard) {
      const taken = state.discard.pop();
      const old = state.ai[knownHighest];
      state.ai[knownHighest] = taken;
      state.aiKnown.add(knownHighest);
      state.discard.push(old);
      say(`Computer took ${pretty(taken)} from the discard.`);
      await pause(650);
    } else {
      refillDeckIfNeeded();
      const drawn = state.deck.pop();
      say("Computer drew from the deck.");
      await pause(500);
      await aiUseDrawnCard(drawn);
    }

    state.aiTurnCount += 1;

    if (state.caboCaller === "player" && state.finalTurnOwner === "ai") return finishGame();

    state.turn = "player";
    state.phase = "await-draw";
    say("Your turn.");
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
      const old = state.ai[highIndex];
      state.ai[highIndex] = card;
      state.aiKnown.add(highIndex);
      state.discard.push(old);
      say("Computer kept the drawn card and replaced one of its cards.");
      await pause(650);
      return;
    }

    state.discard.push(card);
    if (!power) {
      say(`Computer discarded ${pretty(card)}.`);
      await pause(600);
      return;
    }

    say(`Computer discarded ${pretty(card)} and used its power.`);
    await pause(500);
    await aiUsePower(power);
  }

  async function aiUsePower(power) {
    if (power === "peek-own") {
      const unknown = indices(state.ai).filter(i => !state.aiKnown.has(i));
      const i = randomFrom(unknown.length ? unknown : indices(state.ai));
      if (i !== null) state.aiKnown.add(i);
      say("Computer peeked at one of its cards.");
      await pause(600);
      return;
    }

    if (power === "peek-opponent") {
      const unknown = indices(state.player).filter(i => !state.aiKnowsPlayer.has(i));
      const i = randomFrom(unknown.length ? unknown : indices(state.player));
      if (i !== null) state.aiKnowsPlayer.add(i);
      say("Computer peeked at one of your cards.");
      await pause(600);
      return;
    }

    if (power === "blind-swap") {
      const own = highestKnownIndex(state.ai, state.aiKnown) ?? randomFrom(indices(state.ai));
      const opp = randomFrom(indices(state.player));
      if (own !== null && opp !== null) aiSwap(own, opp, false);
      say("Computer made a blind swap.");
      await pause(650);
      return;
    }

    if (power === "swap-check") {
      const own = highestKnownIndex(state.ai, state.aiKnown) ?? randomFrom(indices(state.ai));
      const opp = choosePlayerCardForAiSwap();
      if (own !== null && opp !== null) {
        aiSwap(own, opp, true);
        say("Computer swapped a card, then checked what it received.");
      }
      await pause(650);
      return;
    }

    if (power === "check-swap") {
      const opp = choosePlayerCardToInspect();
      if (opp === null) return;
      state.aiKnowsPlayer.add(opp);
      const own = highestKnownIndex(state.ai, state.aiKnown);
      if (own !== null && score(state.player[opp]) < score(state.ai[own])) {
        aiSwap(own, opp, true);
        say("Computer checked one of your cards and chose to swap.");
      } else {
        say("Computer checked one of your cards and kept both hands as-is.");
      }
      await pause(700);
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
    setTimeout(() => els.resultDialog.showModal(), 700);
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

  function pause(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  els.deck.addEventListener("click", drawFromDeck);
  els.discard.addEventListener("click", drawFromDiscard);
  els.matchBtn.addEventListener("click", enterMatchMode);
  els.caboBtn.addEventListener("click", callCabo);
  els.rulesBtn.addEventListener("click", () => els.rulesDialog.showModal());
  els.closeRulesBtn.addEventListener("click", () => els.rulesDialog.close());
  els.playAgainBtn.addEventListener("click", () => { els.resultDialog.close(); startGame(); });
  els.newGameBtn.addEventListener("click", () => { if (els.resultDialog.open) els.resultDialog.close(); startGame(); });

  startGame();
})();
