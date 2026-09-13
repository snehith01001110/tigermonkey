export const CABO_GAME_TYPE = "cabo";

export const SUITS = ["♠", "♥", "♦", "♣"];
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export class GameRuleError extends Error {
  constructor(message, code = "invalid_action") {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
  }
}

export function makeDeck(idFactory) {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) cards.push({ rank, suit, id: idFactory() });
  }
  cards.push({ rank: "JOKER", suit: "", id: idFactory() });
  cards.push({ rank: "JOKER", suit: "", id: idFactory() });
  return cards;
}

export function shuffle(items, randomInt) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function scoreCard(card) {
  if (card.rank === "JOKER") return 0;
  if (card.rank === "K" && (card.suit === "♥" || card.suit === "♦")) return -1;
  if (card.rank === "A") return 1;
  if (/^\d+$/.test(card.rank)) return Number(card.rank);
  if (card.rank === "J") return 11;
  if (card.rank === "Q") return 12;
  return 13;
}

export function prettyCard(card) {
  if (!card) return "card";
  if (card.rank === "JOKER") return "Joker";
  return `${card.rank}${card.suit}`;
}

export function powerFor(card) {
  if (!card) return null;
  if (card.rank === "7" || card.rank === "8") return "peek-own";
  if (card.rank === "9" || card.rank === "10") return "peek-opponent";
  if (card.rank === "J") return "blind-swap";
  if (card.rank === "Q") return "swap-check";
  if (card.rank === "K") return "check-swap";
  return null;
}

export function createGame({ roomCode, host }) {
  return {
    schemaVersion: 1,
    gameType: CABO_GAME_TYPE,
    roomCode,
    revision: 0,
    roundNumber: 0,
    status: "waiting",
    phase: "waiting",
    players: [{ id: host.id, name: host.name, rematchReady: false }],
    hands: {},
    deck: [],
    discard: [],
    currentPlayerId: null,
    startingPlayerId: null,
    initialReady: {},
    drawn: null,
    drawnSource: null,
    selectedOwn: null,
    selectedOpponent: null,
    reveal: null,
    caboCallerId: null,
    finalTurnPlayerId: null,
    scores: null,
    winnerIds: [],
    history: [{ actorId: "round", text: `${host.name} created the room.` }],
  };
}

export function addPlayer(game, player, tools) {
  assert(game.status === "waiting" && game.players.length === 1, "This room is full.", "room_full");
  assert(!game.players.some((candidate) => candidate.id === player.id), "That player is already seated.");
  game.players.push({ id: player.id, name: player.name, rematchReady: false });
  startRound(game, tools);
  game.revision += 1;
  return game;
}

export function applyAction(game, playerId, action, tools) {
  assert(game.players.some((player) => player.id === playerId), "You are not seated in this room.", "unauthorized");
  assert(action && typeof action.type === "string", "That action is not valid.");

  if (game.status === "peeking") {
    assert(action.type === "READY", "Both players are still looking at their opening cards.");
    assert(!game.initialReady[playerId], "You are already ready.");
    game.initialReady[playerId] = true;
    record(game, playerId, "Ready to play.");
    if (game.players.every((player) => game.initialReady[player.id])) {
      game.status = "playing";
      game.phase = "await-draw";
      record(game, "round", `${playerName(game, game.currentPlayerId)} goes first.`);
    }
    game.revision += 1;
    return game;
  }

  if (game.status === "finished") {
    assert(action.type === "REMATCH", "This round is over.");
    const player = game.players.find((candidate) => candidate.id === playerId);
    assert(!player.rematchReady, "You are already ready for another round.");
    player.rematchReady = true;
    if (game.players.every((candidate) => candidate.rematchReady)) startRound(game, tools);
    game.revision += 1;
    return game;
  }

  assert(game.status === "playing", "The game has not started yet.");
  assert(game.currentPlayerId === playerId, "It is not your turn.", "not_your_turn");

  switch (action.type) {
    case "DRAW_DECK":
      expectPhase(game, "await-draw");
      refillDeck(game, tools.randomInt);
      game.drawn = game.deck.pop();
      game.drawnSource = "deck";
      game.phase = "drawn";
      record(game, playerId, "Drew from the deck.");
      break;

    case "DRAW_DISCARD":
      expectPhase(game, "await-draw");
      assert(game.discard.length > 0, "The discard pile is empty.");
      game.drawn = game.discard.pop();
      game.drawnSource = "discard";
      game.phase = "choose-replace";
      record(game, playerId, `Took ${prettyCard(game.drawn)} from the discard.`);
      break;

    case "REPLACE":
      assert(game.phase === "drawn" || game.phase === "choose-replace", "You cannot replace a card now.");
      replaceDrawn(game, playerId, action.index);
      endTurn(game, playerId);
      break;

    case "DISCARD_DRAWN":
      expectPhase(game, "drawn");
      assert(game.drawnSource === "deck" && game.drawn, "Only a deck card can be discarded directly.");
      discardDrawn(game, playerId);
      break;

    case "MATCH_START":
      expectPhase(game, "await-draw");
      assert(handCount(game.hands[playerId]) > 0, "You have no cards to match.");
      game.phase = "match-mode";
      break;

    case "MATCH_CANCEL":
      expectPhase(game, "match-mode");
      game.phase = "await-draw";
      break;

    case "MATCH":
      expectPhase(game, "match-mode");
      tryMatch(game, playerId, action.index, tools.randomInt);
      break;

    case "CALL_CABO":
      expectPhase(game, "await-draw");
      assert(!game.caboCallerId, "Cabo has already been called.");
      game.caboCallerId = playerId;
      game.finalTurnPlayerId = opponentId(game, playerId);
      game.currentPlayerId = game.finalTurnPlayerId;
      game.phase = "await-draw";
      clearTurnState(game);
      record(game, playerId, "Called Cabo.");
      break;

    case "SELECT_OWN":
      selectOwn(game, playerId, action.index);
      break;

    case "SELECT_OPPONENT":
      selectOpponent(game, playerId, action.index);
      break;

    case "CONFIRM_PEEK":
      expectPhase(game, "power-confirm");
      assert(game.reveal?.viewerId === playerId, "There is no card for you to confirm.");
      record(game, playerId, "Finished looking.");
      clearPowerState(game);
      endTurn(game, playerId);
      break;

    case "SKIP_POWER":
      assert(canSkipPower(game.phase), "There is no power to skip.");
      record(game, playerId, "Skipped the power.");
      clearPowerState(game);
      endTurn(game, playerId);
      break;

    case "KING_KEEP":
      expectPhase(game, "king-swap-choice");
      record(game, playerId, "Kept both hands.");
      clearPowerState(game);
      endTurn(game, playerId);
      break;

    case "KING_SWAP":
      expectPhase(game, "king-swap-choice");
      assertIndex(game.hands[playerId], game.selectedOwn);
      assertIndex(game.hands[opponentId(game, playerId)], game.selectedOpponent);
      swapCards(game, playerId, game.selectedOwn, game.selectedOpponent);
      record(game, playerId, "Swapped the checked card with one of their cards.");
      clearPowerState(game);
      endTurn(game, playerId);
      break;

    default:
      throw new GameRuleError("That action is not supported.");
  }

  game.revision += 1;
  return game;
}

export function viewForPlayer(game, playerId) {
  assert(game.players.some((player) => player.id === playerId), "You are not seated in this room.", "unauthorized");
  const players = game.players.map((player) => ({
    id: player.id,
    name: player.name,
    rematchReady: player.rematchReady,
    hand: (game.hands[player.id] || []).map((card, index) =>
      card ? cardView(card, isCardVisible(game, playerId, player.id, index)) : null,
    ),
  }));

  const drawnVisible = Boolean(
    game.drawn &&
      (game.status === "finished" || game.currentPlayerId === playerId || game.drawnSource === "discard"),
  );

  return {
    schemaVersion: game.schemaVersion,
    gameType: game.gameType,
    roomCode: game.roomCode,
    revision: game.revision,
    roundNumber: game.roundNumber,
    status: game.status,
    phase: game.phase,
    youId: playerId,
    players,
    currentPlayerId: game.currentPlayerId,
    startingPlayerId: game.startingPlayerId,
    initialReady: { ...game.initialReady },
    deckCount: game.deck.length,
    discard: game.discard.slice(-3).map((card) => cardView(card, true)),
    drawn: game.drawn ? cardView(game.drawn, drawnVisible) : null,
    drawnSource: game.drawnSource,
    selectedOwn: game.currentPlayerId === playerId ? game.selectedOwn : null,
    selectedOpponent: game.currentPlayerId === playerId ? game.selectedOpponent : null,
    caboCallerId: game.caboCallerId,
    finalTurnPlayerId: game.finalTurnPlayerId,
    scores: game.status === "finished" ? { ...game.scores } : null,
    winnerIds: game.status === "finished" ? [...game.winnerIds] : [],
    history: game.history.map((entry) => ({ ...entry })),
    legalActions: legalActionsFor(game, playerId),
  };
}

export function legalActionsFor(game, playerId) {
  if (game.status === "waiting") return [];
  if (game.status === "peeking") return game.initialReady[playerId] ? [] : ["READY"];
  if (game.status === "finished") {
    const player = game.players.find((candidate) => candidate.id === playerId);
    return player?.rematchReady ? [] : ["REMATCH"];
  }
  if (game.currentPlayerId !== playerId) return [];

  switch (game.phase) {
    case "await-draw":
      return ["DRAW_DECK", "DRAW_DISCARD", "MATCH_START", ...(game.caboCallerId ? [] : ["CALL_CABO"])];
    case "drawn":
      return ["REPLACE", "DISCARD_DRAWN"];
    case "choose-replace":
      return ["REPLACE"];
    case "match-mode":
      return ["MATCH", "MATCH_CANCEL"];
    case "power-peek-own":
    case "power-j-own":
    case "power-q-own":
    case "power-k-own":
      return ["SELECT_OWN", "SKIP_POWER"];
    case "power-peek-opponent":
    case "power-j-opponent":
    case "power-q-opponent":
    case "power-k-check-opponent":
      return ["SELECT_OPPONENT", "SKIP_POWER"];
    case "power-confirm":
      return ["CONFIRM_PEEK"];
    case "king-swap-choice":
      return ["KING_KEEP", "KING_SWAP"];
    default:
      return [];
  }
}

function startRound(game, tools) {
  assert(game.players.length === 2, "Two players are required.");
  const previousStarter = game.startingPlayerId;
  const starter = previousStarter
    ? opponentId(game, previousStarter)
    : game.players[tools.randomInt(game.players.length)].id;
  const deck = shuffle(makeDeck(tools.idFactory), tools.randomInt);
  const hands = Object.fromEntries(game.players.map((player) => [player.id, []]));

  for (let card = 0; card < 4; card += 1) {
    for (const player of game.players) hands[player.id].push(deck.pop());
  }

  game.roundNumber += 1;
  game.status = "peeking";
  game.phase = "initial-peek";
  game.hands = hands;
  game.deck = deck;
  game.discard = [deck.pop()];
  game.currentPlayerId = starter;
  game.startingPlayerId = starter;
  game.initialReady = Object.fromEntries(game.players.map((player) => [player.id, false]));
  game.drawn = null;
  game.drawnSource = null;
  game.selectedOwn = null;
  game.selectedOpponent = null;
  game.reveal = null;
  game.caboCallerId = null;
  game.finalTurnPlayerId = null;
  game.scores = null;
  game.winnerIds = [];
  game.history = [{ actorId: "round", text: `Round ${game.roundNumber}. Cards dealt.` }];
  for (const player of game.players) player.rematchReady = false;
}

function discardDrawn(game, playerId) {
  const card = game.drawn;
  game.discard.push(card);
  game.drawn = null;
  game.drawnSource = null;
  record(game, playerId, `Discarded ${prettyCard(card)}.`);
  const power = powerFor(card);
  if (!power) return endTurn(game, playerId);
  if (power === "peek-own") game.phase = "power-peek-own";
  else if (power === "peek-opponent") game.phase = "power-peek-opponent";
  else if (power === "blind-swap") game.phase = "power-j-own";
  else if (power === "swap-check") game.phase = "power-q-own";
  else game.phase = "power-k-check-opponent";
}

function replaceDrawn(game, playerId, index) {
  const hand = game.hands[playerId];
  assertIndex(hand, index);
  assert(game.drawn, "There is no drawn card.");
  const old = hand[index];
  hand[index] = game.drawn;
  game.discard.push(old);
  game.drawn = null;
  game.drawnSource = null;
  record(game, playerId, `Replaced a card and discarded ${prettyCard(old)}.`);
}

function tryMatch(game, playerId, index, randomInt) {
  const hand = game.hands[playerId];
  assertIndex(hand, index);
  const card = hand[index];
  const top = game.discard.at(-1);
  assert(top, "The discard pile is empty.");
  if (card.rank === top.rank) {
    hand[index] = null;
    game.discard.push(card);
    record(game, playerId, `Matched the discard with ${prettyCard(card)}.`);
  } else {
    refillDeck(game, randomInt);
    placeCard(hand, game.deck.pop());
    record(game, playerId, `Tried ${prettyCard(card)}. Wrong match — drew a penalty card.`);
  }
  game.phase = "await-draw";
}

function selectOwn(game, playerId, index) {
  assertIndex(game.hands[playerId], index);
  if (game.phase === "power-peek-own") {
    game.reveal = { viewerId: playerId, ownerId: playerId, index };
    game.phase = "power-confirm";
    record(game, playerId, "Peeked at one of their own cards.");
    return;
  }
  if (game.phase === "power-j-own") {
    game.selectedOwn = index;
    game.phase = "power-j-opponent";
    return;
  }
  if (game.phase === "power-q-own") {
    game.selectedOwn = index;
    game.phase = "power-q-opponent";
    return;
  }
  if (game.phase === "power-k-own") {
    game.selectedOwn = index;
    game.phase = "king-swap-choice";
    return;
  }
  throw new GameRuleError("You cannot select one of your cards now.");
}

function selectOpponent(game, playerId, index) {
  const otherId = opponentId(game, playerId);
  assertIndex(game.hands[otherId], index);
  if (game.phase === "power-peek-opponent") {
    game.reveal = { viewerId: playerId, ownerId: otherId, index };
    game.phase = "power-confirm";
    record(game, playerId, "Peeked at an opponent card.");
    return;
  }
  if (game.phase === "power-j-opponent") {
    assertIndex(game.hands[playerId], game.selectedOwn);
    swapCards(game, playerId, game.selectedOwn, index);
    record(game, playerId, "Blind-swapped one card with their opponent.");
    clearPowerState(game);
    endTurn(game, playerId);
    return;
  }
  if (game.phase === "power-q-opponent") {
    const ownIndex = game.selectedOwn;
    assertIndex(game.hands[playerId], ownIndex);
    swapCards(game, playerId, ownIndex, index);
    game.reveal = { viewerId: playerId, ownerId: playerId, index: ownIndex };
    game.selectedOwn = null;
    game.selectedOpponent = null;
    game.phase = "power-confirm";
    record(game, playerId, "Swapped a card and checked what they received.");
    return;
  }
  if (game.phase === "power-k-check-opponent") {
    game.selectedOpponent = index;
    game.reveal = { viewerId: playerId, ownerId: otherId, index };
    game.phase = "power-k-own";
    record(game, playerId, "Checked an opponent card.");
    return;
  }
  throw new GameRuleError("You cannot select an opponent card now.");
}

function swapCards(game, playerId, ownIndex, opponentIndex) {
  const otherId = opponentId(game, playerId);
  const own = game.hands[playerId][ownIndex];
  game.hands[playerId][ownIndex] = game.hands[otherId][opponentIndex];
  game.hands[otherId][opponentIndex] = own;
}

function endTurn(game, playerId) {
  clearTurnState(game);
  if (game.caboCallerId && game.finalTurnPlayerId === playerId) {
    finishGame(game);
    return;
  }
  game.currentPlayerId = opponentId(game, playerId);
  game.phase = "await-draw";
}

function finishGame(game) {
  game.status = "finished";
  game.phase = "game-over";
  game.currentPlayerId = null;
  game.scores = Object.fromEntries(
    game.players.map((player) => [
      player.id,
      game.hands[player.id].reduce((total, card) => total + (card ? scoreCard(card) : 0), 0),
    ]),
  );
  const best = Math.min(...Object.values(game.scores));
  game.winnerIds = game.players.filter((player) => game.scores[player.id] === best).map((player) => player.id);
  const scores = game.players.map((player) => `${player.name} ${game.scores[player.id]}`).join(", ");
  record(game, "round", `Final scores: ${scores}.`);
}

function refillDeck(game, randomInt) {
  if (game.deck.length > 0) return;
  assert(game.discard.length > 1, "There are no cards left to draw.");
  const top = game.discard.pop();
  game.deck = shuffle(game.discard.splice(0), randomInt);
  game.discard = [top];
}

function clearPowerState(game) {
  game.selectedOwn = null;
  game.selectedOpponent = null;
  game.reveal = null;
}

function clearTurnState(game) {
  game.drawn = null;
  game.drawnSource = null;
  clearPowerState(game);
}

function isCardVisible(game, viewerId, ownerId, index) {
  if (game.status === "finished") return true;
  if (game.status === "peeking" && viewerId === ownerId && !game.initialReady[viewerId]) {
    return index === 2 || index === 3;
  }
  const reveal = game.reveal;
  return Boolean(
    reveal && reveal.viewerId === viewerId && reveal.ownerId === ownerId && reveal.index === index,
  );
}

function cardView(card, visible) {
  return visible
    ? { id: card.id, rank: card.rank, suit: card.suit, hidden: false }
    : { id: card.id, hidden: true };
}

function canSkipPower(phase) {
  return [
    "power-peek-own",
    "power-peek-opponent",
    "power-j-own",
    "power-j-opponent",
    "power-q-own",
    "power-q-opponent",
    "power-k-check-opponent",
    "power-k-own",
  ].includes(phase);
}

function opponentId(game, playerId) {
  const opponent = game.players.find((player) => player.id !== playerId);
  assert(opponent, "This room needs another player.");
  return opponent.id;
}

function playerName(game, playerId) {
  return game.players.find((player) => player.id === playerId)?.name || "Player";
}

function expectPhase(game, phase) {
  assert(game.phase === phase, "That action is not available now.");
}

function assertIndex(hand, index) {
  assert(
    Number.isInteger(index) && index >= 0 && index < hand.length && Boolean(hand[index]),
    "That card is not available.",
  );
}

// A hand is a fixed set of spots: a card that leaves it empties its spot rather than
// sliding the rest of the hand up, so cards stay where each player memorized them.
function handCount(hand) {
  return hand.filter(Boolean).length;
}

// A card coming into a hand takes the first empty spot, and only grows the hand when
// every spot is filled.
function placeCard(hand, card) {
  const empty = hand.indexOf(null);
  if (empty !== -1) {
    hand[empty] = card;
    return empty;
  }
  hand.push(card);
  return hand.length - 1;
}

function record(game, actorId, text) {
  game.history.push({ actorId, text });
  if (game.history.length > 100) game.history.splice(0, game.history.length - 100);
}

function assert(condition, message, code) {
  if (!condition) throw new GameRuleError(message, code);
}
