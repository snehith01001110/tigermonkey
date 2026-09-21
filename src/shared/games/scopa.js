import { GameRuleError } from "./errors.js";

export const SCOPA_GAME_TYPE = "scopa";
export const MATCH_LIMIT = 11;

export const SUITS = ["♠", "♥", "♦", "♣"];
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "J", "Q", "K"];

const PRIMIERA_VALUES = Object.freeze({
  A: 16,
  2: 12,
  3: 13,
  4: 14,
  5: 15,
  6: 18,
  7: 21,
  J: 10,
  Q: 10,
  K: 10,
});

export function createGame({ roomCode, host }) {
  return {
    schemaVersion: 1,
    gameType: SCOPA_GAME_TYPE,
    roomCode,
    revision: 0,
    roundNumber: 0,
    batchNumber: 0,
    status: "waiting",
    phase: "waiting",
    players: [{ id: host.id, name: host.name, ready: false }],
    hands: {},
    deck: [],
    table: [],
    captures: {},
    scopas: {},
    scores: { [host.id]: 0 },
    roundScores: null,
    roundBreakdown: null,
    roundWinnerIds: [],
    matchWinnerIds: [],
    currentPlayerId: null,
    dealerId: null,
    startingPlayerId: null,
    lastCapturerId: null,
    history: [{ actorId: "round", text: `${host.name} created the Scopa room.` }],
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

  if (action.type !== "PLAY_CARD") throw new GameRuleError("That action is not supported.");
  playCard(game, playerId, action.handIndex, action.captureIds);
  game.revision += 1;
  return game;
}

export function viewForPlayer(game, playerId) {
  assert(game.players.some((player) => player.id === playerId), "You are not seated in this room.", "unauthorized");

  return {
    schemaVersion: game.schemaVersion,
    gameType: game.gameType,
    roomCode: game.roomCode,
    revision: game.revision,
    roundNumber: game.roundNumber,
    batchNumber: game.batchNumber,
    status: game.status,
    phase: game.phase,
    youId: playerId,
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      ready: player.ready,
      hand: (game.hands[player.id] || []).map((card) => cardView(card, player.id === playerId)),
      captured: (game.captures[player.id] || []).map((card) => cardView(card, true)),
      scopas: game.scopas[player.id] || 0,
    })),
    table: game.table.map((card) => cardView(card, true)),
    deckCount: game.deck.length,
    currentPlayerId: game.currentPlayerId,
    dealerId: game.dealerId,
    startingPlayerId: game.startingPlayerId,
    scores: { ...game.scores },
    roundScores: game.roundScores ? { ...game.roundScores } : null,
    roundBreakdown: cloneBreakdown(game.roundBreakdown),
    roundWinnerIds: [...game.roundWinnerIds],
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
  return game.currentPlayerId === playerId ? ["PLAY_CARD"] : [];
}

export function makeDeck(idFactory) {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit, id: idFactory() })));
}

export function cardValue(card) {
  if (card.rank === "A") return 1;
  if (/^[2-7]$/.test(card.rank)) return Number(card.rank);
  return { J: 8, Q: 9, K: 10 }[card.rank];
}

export function prettyCard(card) {
  return `${card.rank}${card.suit}`;
}

/* A matching single card always takes precedence. Only when there is no single match
   may a player capture a set whose values add up to the played card. */
export function captureOptions(table, playedCard) {
  if (!playedCard) return [];
  const target = cardValue(playedCard);
  const singleMatches = table.filter((card) => cardValue(card) === target);
  if (singleMatches.length) return singleMatches.map((card) => [card.id]);

  const options = [];
  const chosen = [];

  function visit(start, total) {
    if (total === target) {
      if (chosen.length >= 2) options.push(chosen.map((card) => card.id));
      return;
    }
    for (let index = start; index < table.length; index += 1) {
      const card = table[index];
      const next = total + cardValue(card);
      if (next > target) continue;
      chosen.push(card);
      visit(index + 1, next);
      chosen.pop();
    }
  }

  visit(0, 0);
  return options;
}

export function primieraScore(cards) {
  let total = 0;
  for (const suit of SUITS) {
    const values = cards.filter((card) => card.suit === suit).map((card) => PRIMIERA_VALUES[card.rank]);
    if (!values.length) return null;
    total += Math.max(...values);
  }
  return total;
}

export function calculateRoundScores(players, captures, scopas) {
  const ids = players.map((player) => player.id);
  const points = Object.fromEntries(ids.map((id) => [id, scopas[id] || 0]));
  const cards = Object.fromEntries(ids.map((id) => [id, (captures[id] || []).length]));
  const diamonds = Object.fromEntries(ids.map((id) => [id, (captures[id] || []).filter((card) => card.suit === "♦").length]));
  const settebello = Object.fromEntries(ids.map((id) => [id, (captures[id] || []).some((card) => card.suit === "♦" && card.rank === "7")]));
  const primiera = Object.fromEntries(ids.map((id) => [id, primieraScore(captures[id] || [])]));
  const awards = {
    cards: soleHighValue(cards),
    diamonds: soleHighValue(diamonds),
    settebello: ids.find((id) => settebello[id]) || null,
    primiera: soleHighValue(primiera),
  };

  for (const winner of Object.values(awards)) {
    if (winner) points[winner] += 1;
  }

  return {
    points,
    breakdown: {
      scopas: Object.fromEntries(ids.map((id) => [id, scopas[id] || 0])),
      cards,
      diamonds,
      settebello,
      primiera,
      awards,
    },
  };
}

function startRound(game, tools) {
  assert(game.players.length === 2, "Two players are required.");
  const dealerId = game.dealerId
    ? opponentId(game, game.dealerId)
    : game.players[tools.randomInt(game.players.length)].id;
  const startingPlayerId = opponentId(game, dealerId);
  const deal = shuffledDeal(tools);

  game.roundNumber += 1;
  game.batchNumber = 1;
  game.status = "playing";
  game.phase = "play";
  game.hands = Object.fromEntries(game.players.map((player) => [player.id, []]));
  game.captures = Object.fromEntries(game.players.map((player) => [player.id, []]));
  game.scopas = Object.fromEntries(game.players.map((player) => [player.id, 0]));
  game.deck = deal.deck;
  game.table = deal.table;
  game.dealerId = dealerId;
  game.startingPlayerId = startingPlayerId;
  game.currentPlayerId = startingPlayerId;
  game.lastCapturerId = null;
  game.roundScores = null;
  game.roundBreakdown = null;
  game.roundWinnerIds = [];
  game.matchWinnerIds = [];
  for (const player of game.players) player.ready = false;
  dealHands(game);
  record(game, "round", `Round ${game.roundNumber}. ${playerName(game, startingPlayerId)} plays first.`);
}

function startNewMatch(game, tools) {
  game.roundNumber = 0;
  game.dealerId = null;
  game.scores = Object.fromEntries(game.players.map((player) => [player.id, 0]));
  record(game, "round", "New Scopa match.");
  startRound(game, tools);
}

function shuffledDeal(tools) {
  let deck = shuffle(makeDeck(tools.idFactory), tools.randomInt);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = [...deck];
    const hands = Array.from({ length: 6 }, () => candidate.pop());
    const table = Array.from({ length: 4 }, () => candidate.pop());
    if (table.filter((card) => card.rank === "K").length < 3) {
      // Return the six hand cards to the deck. They are dealt in player order below.
      candidate.push(...hands.reverse());
      return { deck: candidate, table };
    }
    deck = shuffle([...candidate, ...hands, ...table], tools.randomInt);
  }

  // This is reachable only with a pathological random source. Rotate until the opening
  // table is playable so tests and local fallback randomness can never loop forever.
  for (let offset = 1; offset < deck.length; offset += 1) {
    const rotated = [...deck.slice(offset), ...deck.slice(0, offset)];
    const candidate = [...rotated];
    const hands = Array.from({ length: 6 }, () => candidate.pop());
    const table = Array.from({ length: 4 }, () => candidate.pop());
    if (table.filter((card) => card.rank === "K").length < 3) {
      candidate.push(...hands.reverse());
      return { deck: candidate, table };
    }
  }
  throw new GameRuleError("The cards could not be dealt.");
}

function dealHands(game) {
  assert(game.deck.length >= game.players.length * 3, "There are not enough cards to deal.");
  const order = [
    game.players.find((player) => player.id === game.startingPlayerId),
    game.players.find((player) => player.id === game.dealerId),
  ];
  for (let card = 0; card < 3; card += 1) {
    for (const player of order) game.hands[player.id].push(game.deck.pop());
  }
}

function playCard(game, playerId, handIndex, requestedCaptureIds = []) {
  const hand = game.hands[playerId];
  assertIndex(hand, handIndex);
  assert(Array.isArray(requestedCaptureIds), "That capture is not valid.");
  assert(requestedCaptureIds.every((id) => typeof id === "string"), "That capture is not valid.");
  assert(new Set(requestedCaptureIds).size === requestedCaptureIds.length, "That capture is not valid.");

  const playedCard = hand[handIndex];
  const options = captureOptions(game.table, playedCard);
  const captureIds = [...requestedCaptureIds];
  if (options.length) {
    assert(options.some((option) => sameIds(option, captureIds)), "Choose one of the available captures.");
  } else {
    assert(captureIds.length === 0, "That card cannot capture those cards.");
  }

  hand.splice(handIndex, 1);
  let captured = [];
  let swept = false;
  if (captureIds.length) {
    const chosen = new Set(captureIds);
    captured = game.table.filter((card) => chosen.has(card.id));
    game.table = game.table.filter((card) => !chosen.has(card.id));
    game.captures[playerId].push(...captured, playedCard);
    game.lastCapturerId = playerId;
    const finalPlay = game.deck.length === 0 && game.players.every((player) => game.hands[player.id].length === 0);
    swept = game.table.length === 0 && !finalPlay;
    if (swept) game.scopas[playerId] += 1;
    record(
      game,
      playerId,
      swept
        ? `Scopa! Played ${prettyCard(playedCard)} and swept the table.`
        : `Played ${prettyCard(playedCard)} and took ${captured.map(prettyCard).join(", ")}.`,
    );
  } else {
    game.table.push(playedCard);
    record(game, playerId, `Played ${prettyCard(playedCard)} to the table.`);
  }

  if (game.deck.length === 0 && game.players.every((player) => game.hands[player.id].length === 0)) {
    finishRound(game);
    return;
  }

  if (game.players.every((player) => game.hands[player.id].length === 0)) {
    dealHands(game);
    game.batchNumber += 1;
  }
  game.currentPlayerId = opponentId(game, playerId);
}

function finishRound(game) {
  const recipient = game.lastCapturerId || game.dealerId;
  if (game.table.length) {
    game.captures[recipient].push(...game.table);
    game.table = [];
  }

  const { points, breakdown } = calculateRoundScores(game.players, game.captures, game.scopas);
  game.roundScores = points;
  game.roundBreakdown = breakdown;
  for (const player of game.players) {
    game.scores[player.id] += points[player.id];
    player.ready = false;
  }

  const highRound = Math.max(...Object.values(points));
  game.roundWinnerIds = game.players.filter((player) => points[player.id] === highRound).map((player) => player.id);
  game.currentPlayerId = null;
  game.phase = "round-over";
  record(
    game,
    "round",
    game.players.map((player) => `${player.name} scored ${points[player.id]}`).join(" · "),
  );

  const highMatch = Math.max(...Object.values(game.scores));
  const leaders = game.players.filter((player) => game.scores[player.id] === highMatch).map((player) => player.id);
  if (highMatch >= MATCH_LIMIT && leaders.length === 1) {
    game.status = "match-finished";
    game.phase = "match-over";
    game.matchWinnerIds = leaders;
  } else {
    game.status = "round-finished";
  }
}

function soleHighValue(values) {
  const eligible = Object.entries(values).filter(([, value]) => value !== null && value !== false);
  if (!eligible.length) return null;
  const high = Math.max(...eligible.map(([, value]) => Number(value)));
  const winners = eligible.filter(([, value]) => Number(value) === high);
  return winners.length === 1 ? winners[0][0] : null;
}

function sameIds(left, right) {
  if (left.length !== right.length) return false;
  const set = new Set(right);
  return left.every((id) => set.has(id));
}

function markReady(game, playerId) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  assert(!player.ready, "You are already ready.");
  player.ready = true;
}

function cardView(card, visible) {
  return visible ? { id: card.id, rank: card.rank, suit: card.suit, hidden: false } : { id: card.id, hidden: true };
}

function cloneBreakdown(breakdown) {
  if (!breakdown) return null;
  return {
    scopas: { ...breakdown.scopas },
    cards: { ...breakdown.cards },
    diamonds: { ...breakdown.diamonds },
    settebello: { ...breakdown.settebello },
    primiera: { ...breakdown.primiera },
    awards: { ...breakdown.awards },
  };
}

function assertIndex(hand, index) {
  assert(Number.isInteger(index) && index >= 0 && index < hand.length && hand[index], "That card is not available.");
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

function shuffle(items, randomInt) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

function assert(condition, message, code) {
  if (!condition) throw new GameRuleError(message, code);
}
