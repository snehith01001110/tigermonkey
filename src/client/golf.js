export const GOLF_GAME_TYPE = "golf";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function createGolfGame(tools) {
  const deck = shuffle(makeDeck(tools.idFactory), tools.randomInt);
  const tableau = Array.from({ length: 7 }, () => []);

  for (let row = 0; row < 5; row += 1) {
    for (const column of tableau) column.push(deck.pop());
  }

  return {
    stock: deck,
    waste: deck.pop(),
    tableau,
    moves: 0,
    status: "playing",
    history: [{ type: "deal" }],
    undoStack: [],
  };
}

export function canPlayOnWaste(card, waste) {
  if (!card || !waste) return false;
  const gap = Math.abs(rankValue(card.rank) - rankValue(waste.rank));
  return gap === 1 || gap === RANKS.length - 1;
}

export function playableColumns(game) {
  return game.tableau
    .map((column, index) => ({ card: column.at(-1), index }))
    .filter(({ card }) => canPlayOnWaste(card, game.waste))
    .map(({ index }) => index);
}

export function playTableauCard(game, columnIndex) {
  assertPlayable(game);
  const column = game.tableau[columnIndex];
  const card = column?.at(-1);
  if (!canPlayOnWaste(card, game.waste)) throw new Error("That card does not continue the sequence.");

  saveUndo(game);
  column.pop();
  game.waste = card;
  game.moves += 1;
  game.history.push({ type: "play", card, columnIndex });
  updateStatus(game);
  return game;
}

export function drawStockCard(game) {
  assertPlayable(game);
  if (!game.stock.length) throw new Error("The stock is empty.");

  saveUndo(game);
  game.waste = game.stock.pop();
  game.moves += 1;
  game.history.push({ type: "draw", card: game.waste });
  updateStatus(game);
  return game;
}

export function undoGolfMove(game) {
  const previous = game.undoStack.pop();
  if (!previous) return false;
  game.stock = previous.stock;
  game.waste = previous.waste;
  game.tableau = previous.tableau;
  game.moves = previous.moves;
  game.status = previous.status;
  game.history.pop();
  return true;
}

export function cardsRemaining(game) {
  return game.tableau.reduce((total, column) => total + column.length, 0);
}

export function prettyGolfCard(card) {
  return `${card.rank}${card.suit}`;
}

function makeDeck(idFactory) {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit, id: idFactory() })));
}

function rankValue(rank) {
  return RANKS.indexOf(rank);
}

function saveUndo(game) {
  game.undoStack.push({
    stock: [...game.stock],
    waste: game.waste,
    tableau: game.tableau.map((column) => [...column]),
    moves: game.moves,
    status: game.status,
  });
}

function updateStatus(game) {
  if (cardsRemaining(game) === 0) {
    game.status = "won";
  } else if (!game.stock.length && playableColumns(game).length === 0) {
    game.status = "lost";
  }
}

function assertPlayable(game) {
  if (game.status !== "playing") throw new Error("This game is over. Start a new game to continue.");
}

function shuffle(items, randomInt) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}
