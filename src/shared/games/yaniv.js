import { GameRuleError } from "./errors.js";

export const YANIV_GAME_TYPE = "yaniv";
export const CALL_LIMIT = 5;
export const ASSAF_PENALTY = 30;
export const MATCH_LIMIT = 200;

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function createGame({ roomCode, host }) {
  return {
    schemaVersion: 1,
    gameType: YANIV_GAME_TYPE,
    roomCode,
    revision: 0,
    roundNumber: 0,
    status: "waiting",
    phase: "waiting",
    players: [{ id: host.id, name: host.name, ready: false }],
    hands: {},
    deck: [],
    discard: [],
    pendingDiscard: [],
    selectedIndices: [],
    currentPlayerId: null,
    startingPlayerId: null,
    scores: { [host.id]: 0 },
    roundScores: null,
    roundHandValues: null,
    callerId: null,
    roundWinnerId: null,
    assaf: false,
    matchWinnerIds: [],
    history: [{ actorId: "round", text: `${host.name} created the Yaniv room.` }],
  };
}

export function addPlayer(game, player, tools) {
  assert(game.status === "waiting" && game.players.length === 1, "This room is full.", "room_full");
  assert(!game.players.some((candidate) => candidate.id === player.id), "That player is already seated.");
  game.players.push({ id: player.id, name: player.name, ready: false });
  game.scores[player.id] = 0;
  startRound(game, tools);
  game.revision += 1;
  return game;
}

export function applyAction(game, playerId, action, tools) {
  assert(game.players.some((player) => player.id === playerId), "You are not seated in this room.", "unauthorized");
  assert(action && typeof action.type === "string", "That action is not valid.");

  if (game.status === "round-finished") {
    assert(action.type === "READY_NEXT", "This round is over.");
    markReady(game, playerId);
    if (game.players.every((player) => player.ready)) startRound(game, tools);
    game.revision += 1;
    return game;
  }

  if (game.status === "match-finished") {
    assert(action.type === "REMATCH", "This match is over.");
    markReady(game, playerId);
    if (game.players.every((player) => player.ready)) startNewMatch(game, tools);
    game.revision += 1;
    return game;
  }

  assert(game.status === "playing", "The game has not started yet.");
  assert(game.currentPlayerId === playerId, "It is not your turn.", "not_your_turn");

  switch (action.type) {
    case "TOGGLE_CARD":
      expectPhase(game, "select-discard");
      toggleCard(game, playerId, action.index);
      break;

    case "PLAY_SELECTED":
      expectPhase(game, "select-discard");
      playSelected(game, playerId);
      break;

    case "DRAW_DECK":
      expectPhase(game, "await-draw");
      refillDeck(game, tools.randomInt);
      game.hands[playerId].push(game.deck.pop());
      record(game, playerId, "Drew from the deck.");
      finishTurn(game, playerId);
      break;

    case "DRAW_DISCARD": {
      expectPhase(game, "await-draw");
      const meld = game.discard.at(-1);
      assert(meld?.length, "The discard pile is empty.");
      const card = meld.pop();
      if (!meld.length) game.discard.pop();
      game.hands[playerId].push(card);
      record(game, playerId, `Took ${prettyCard(card)} from the discard.`);
      finishTurn(game, playerId);
      break;
    }

    case "CALL_YANIV":
      expectPhase(game, "select-discard");
      assert(handValue(game.hands[playerId]) <= CALL_LIMIT, `You need ${CALL_LIMIT} points or fewer to call Yaniv.`);
      finishRound(game, playerId);
      break;

    default:
      throw new GameRuleError("That action is not supported.");
  }

  game.revision += 1;
  return game;
}

export function viewForPlayer(game, playerId) {
  assert(game.players.some((player) => player.id === playerId), "You are not seated in this room.", "unauthorized");
  const revealHands = game.status === "round-finished" || game.status === "match-finished";

  return {
    schemaVersion: game.schemaVersion,
    gameType: game.gameType,
    roomCode: game.roomCode,
    revision: game.revision,
    roundNumber: game.roundNumber,
    status: game.status,
    phase: game.phase,
    youId: playerId,
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      ready: player.ready,
      hand: (game.hands[player.id] || []).map((card) => cardView(card, revealHands || player.id === playerId)),
    })),
    currentPlayerId: game.currentPlayerId,
    startingPlayerId: game.startingPlayerId,
    deckCount: game.deck.length,
    discard: (game.discard.at(-1) || []).map((card) => cardView(card, true)),
    pendingDiscard: game.pendingDiscard.map((card) => cardView(card, true)),
    selectedIndices: game.currentPlayerId === playerId ? [...game.selectedIndices] : [],
    scores: { ...game.scores },
    roundScores: game.roundScores ? { ...game.roundScores } : null,
    roundHandValues: game.roundHandValues ? { ...game.roundHandValues } : null,
    callerId: game.callerId,
    roundWinnerId: game.roundWinnerId,
    assaf: game.assaf,
    matchWinnerIds: [...game.matchWinnerIds],
    history: game.history.map((entry) => ({ ...entry })),
    legalActions: legalActionsFor(game, playerId),
  };
}

export function legalActionsFor(game, playerId) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player || game.status === "waiting") return [];
  if (game.status === "round-finished") return player.ready ? [] : ["READY_NEXT"];
  if (game.status === "match-finished") return player.ready ? [] : ["REMATCH"];
  if (game.currentPlayerId !== playerId) return [];

  if (game.phase === "select-discard") {
    const actions = ["TOGGLE_CARD"];
    const selected = selectedCards(game, playerId);
    if (isValidMeld(selected)) actions.push("PLAY_SELECTED");
    if (handValue(game.hands[playerId]) <= CALL_LIMIT) actions.push("CALL_YANIV");
    return actions;
  }
  if (game.phase === "await-draw") {
    return ["DRAW_DECK", ...((game.discard.at(-1) || []).length ? ["DRAW_DISCARD"] : [])];
  }
  return [];
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

export function scoreCard(card) {
  if (card.rank === "JOKER") return 0;
  if (card.rank === "A") return 1;
  if (/^\d+$/.test(card.rank)) return Number(card.rank);
  return 10;
}

export function handValue(hand) {
  return hand.reduce((total, card) => total + scoreCard(card), 0);
}

export function prettyCard(card) {
  return card.rank === "JOKER" ? "Joker" : `${card.rank}${card.suit}`;
}

export function isValidMeld(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return false;
  if (cards.length === 1) return true;
  return isSet(cards) || isRun(cards);
}

function isSet(cards) {
  const ranks = new Set(cards.filter((card) => card.rank !== "JOKER").map((card) => card.rank));
  return ranks.size <= 1;
}

function isRun(cards) {
  if (cards.length < 3 || cards.length > 13) return false;
  const natural = cards.filter((card) => card.rank !== "JOKER");
  if (!natural.length) return true;
  if (new Set(natural.map((card) => card.suit)).size !== 1) return false;
  const values = natural.map((card) => rankValue(card.rank)).sort((a, b) => a - b);
  if (new Set(values).size !== values.length) return false;
  return values.at(-1) - values[0] + 1 <= cards.length;
}

function rankValue(rank) {
  if (rank === "A") return 1;
  if (/^\d+$/.test(rank)) return Number(rank);
  return { J: 11, Q: 12, K: 13 }[rank];
}

function startRound(game, tools) {
  assert(game.players.length === 2, "Two players are required.");
  const starter = game.startingPlayerId
    ? opponentId(game, game.startingPlayerId)
    : game.players[tools.randomInt(game.players.length)].id;
  const deck = shuffle(makeDeck(tools.idFactory), tools.randomInt);
  const hands = Object.fromEntries(game.players.map((player) => [player.id, []]));

  for (let card = 0; card < 5; card += 1) {
    for (const player of game.players) hands[player.id].push(deck.pop());
  }

  game.roundNumber += 1;
  game.status = "playing";
  game.phase = "select-discard";
  game.hands = hands;
  game.deck = deck;
  game.discard = [[deck.pop()]];
  game.pendingDiscard = [];
  game.selectedIndices = [];
  game.currentPlayerId = starter;
  game.startingPlayerId = starter;
  game.roundScores = null;
  game.roundHandValues = null;
  game.callerId = null;
  game.roundWinnerId = null;
  game.assaf = false;
  game.matchWinnerIds = [];
  for (const player of game.players) player.ready = false;
  record(game, "round", `Round ${game.roundNumber}. ${playerName(game, starter)} goes first.`);
}

function startNewMatch(game, tools) {
  game.roundNumber = 0;
  game.startingPlayerId = null;
  game.scores = Object.fromEntries(game.players.map((player) => [player.id, 0]));
  record(game, "round", "New Yaniv match.");
  startRound(game, tools);
}

function toggleCard(game, playerId, index) {
  assertIndex(game.hands[playerId], index);
  const selected = new Set(game.selectedIndices);
  if (selected.has(index)) selected.delete(index);
  else selected.add(index);
  game.selectedIndices = [...selected].sort((a, b) => a - b);
}

function selectedCards(game, playerId) {
  return game.selectedIndices.map((index) => game.hands[playerId][index]).filter(Boolean);
}

function playSelected(game, playerId) {
  const cards = selectedCards(game, playerId);
  assert(isValidMeld(cards), "Choose one card, a same-rank set, or a same-suit run of at least three.");
  const selected = new Set(game.selectedIndices);
  game.hands[playerId] = game.hands[playerId].filter((_, index) => !selected.has(index));
  game.pendingDiscard = orderMeld(cards);
  game.selectedIndices = [];
  game.phase = "await-draw";
  record(game, playerId, `Played ${cards.map(prettyCard).join(", ")}.`);
}

function orderMeld(cards) {
  if (!isRun(cards)) return [...cards];
  return [...cards].sort((a, b) => {
    if (a.rank === "JOKER" && b.rank === "JOKER") return 0;
    if (a.rank === "JOKER") return 1;
    if (b.rank === "JOKER") return -1;
    return rankValue(a.rank) - rankValue(b.rank);
  });
}

function finishTurn(game, playerId) {
  assert(game.pendingDiscard.length, "Play cards before drawing.");
  game.discard.push(game.pendingDiscard);
  game.pendingDiscard = [];
  game.selectedIndices = [];
  game.currentPlayerId = opponentId(game, playerId);
  game.phase = "select-discard";
}

function finishRound(game, callerId) {
  const opponent = opponentId(game, callerId);
  const callerValue = handValue(game.hands[callerId]);
  const opponentValue = handValue(game.hands[opponent]);
  const assaf = opponentValue <= callerValue;
  const roundScores = {
    [callerId]: assaf ? callerValue + ASSAF_PENALTY : 0,
    [opponent]: assaf ? 0 : opponentValue,
  };

  game.callerId = callerId;
  game.assaf = assaf;
  game.roundWinnerId = assaf ? opponent : callerId;
  game.roundHandValues = { [callerId]: callerValue, [opponent]: opponentValue };
  game.roundScores = roundScores;
  for (const player of game.players) {
    game.scores[player.id] += roundScores[player.id];
    player.ready = false;
  }
  game.pendingDiscard = [];
  game.selectedIndices = [];
  game.currentPlayerId = null;
  record(game, callerId, `Called Yaniv with ${callerValue}.`);
  record(
    game,
    "round",
    assaf
      ? `Assaf — ${playerName(game, opponent)} had ${opponentValue}. ${playerName(game, callerId)} takes ${ASSAF_PENALTY} extra points.`
      : `${playerName(game, callerId)} won the round. ${playerName(game, opponent)} adds ${opponentValue}.`,
  );

  if (Object.values(game.scores).some((score) => score >= MATCH_LIMIT)) {
    const low = Math.min(...Object.values(game.scores));
    game.status = "match-finished";
    game.phase = "match-over";
    game.matchWinnerIds = game.players.filter((player) => game.scores[player.id] === low).map((player) => player.id);
  } else {
    game.status = "round-finished";
    game.phase = "round-over";
  }
}

function refillDeck(game, randomInt) {
  if (game.deck.length) return;
  const top = game.discard.pop() || [];
  const recyclable = game.discard.flat();
  game.discard = top.length ? [top] : [];
  assert(recyclable.length, "There are no cards left to draw.");
  game.deck = shuffle(recyclable, randomInt);
}

function shuffle(items, randomInt) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

function markReady(game, playerId) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  assert(!player.ready, "You are already ready.");
  player.ready = true;
}

function cardView(card, visible) {
  return visible ? { id: card.id, rank: card.rank, suit: card.suit, hidden: false } : { id: card.id, hidden: true };
}

function assertIndex(hand, index) {
  assert(Number.isInteger(index) && index >= 0 && index < hand.length && hand[index], "That card is not available.");
}

function expectPhase(game, phase) {
  assert(game.phase === phase, "That action is not available now.");
}

function opponentId(game, playerId) {
  return game.players.find((player) => player.id !== playerId)?.id;
}

function playerName(game, playerId) {
  return game.players.find((player) => player.id === playerId)?.name || "Player";
}

function record(game, actorId, text) {
  game.history.push({ actorId, text });
  if (game.history.length > 80) game.history.splice(0, game.history.length - 80);
}

function assert(condition, message, code) {
  if (!condition) throw new GameRuleError(message, code);
}
