import { gameTypeFromUrl, gameUrl, roomCodeFromUrl, selectedGameTypeFromUrl } from "./config.js";
import { GAME_CATALOG } from "./games.js";
import { setupKeyboardControls } from "./keyboard.js";

const roomCode = roomCodeFromUrl();
const selectedGameType = selectedGameTypeFromUrl();
const gameType = selectedGameType || gameTypeFromUrl();
const home = document.getElementById("gameHome");
const gameApp = document.getElementById("gameApp");
const gamePicker = document.getElementById("gamePicker");
const gameMenuButton = document.getElementById("gameMenuButton");
const gameMenu = document.getElementById("gameMenu");
const game = GAME_CATALOG.find((candidate) => candidate.id === gameType);
const supportsMultiplayer = game?.multiplayer !== false;
document.getElementById("currentGameLabel").textContent = game?.name || gameType;

for (const game of GAME_CATALOG) {
  const link = document.createElement("a");
  link.className = "game-menu-item";
  link.href = gameUrl(game.id);
  link.role = "menuitem";
  if (game.id === gameType) link.setAttribute("aria-current", "page");
  link.innerHTML = `<span>${game.name}</span><span class="game-menu-check" aria-hidden="true">✓</span>`;
  gameMenu.appendChild(link);
}

function setGameMenuOpen(open) {
  gameMenu.hidden = !open;
  gameMenuButton.setAttribute("aria-expanded", String(open));
}

gameMenuButton.addEventListener("click", () => setGameMenuOpen(gameMenu.hidden));
document.addEventListener("click", (event) => {
  if (!gamePicker.contains(event.target)) setGameMenuOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || gameMenu.hidden) return;
  setGameMenuOpen(false);
  gameMenuButton.focus();
});

const gameGrid = document.getElementById("gameGrid");
for (const game of GAME_CATALOG) {
  const link = document.createElement("a");
  link.className = "game-choice";
  link.href = gameUrl(game.id);
  link.innerHTML = `
    <strong>${game.name}</strong>
    <span class="game-arrow" aria-hidden="true">→</span>`;
  gameGrid.appendChild(link);
}

if (!roomCode && !selectedGameType) {
  document.body.dataset.game = "home";
  document.title = "TigerMonkey — Card Games";
  home.hidden = false;
  gameApp.hidden = true;
} else {
  document.body.dataset.game = gameType;
  document.title = `TigerMonkey — ${game?.name || gameType}`;
  document.getElementById("rulesTitle").textContent = game?.name || gameType;

  gameMenuButton.disabled = Boolean(roomCode && supportsMultiplayer);
  if (roomCode && supportsMultiplayer) gameMenuButton.title = "Leave the room before changing games";
  for (const rules of document.querySelectorAll("[data-rules-for]")) rules.hidden = rules.dataset.rulesFor !== gameType;

  if (gameType !== "dice") setupKeyboardControls();

  if (roomCode && supportsMultiplayer) {
    if (gameType === "yaniv") {
      const { startYanivOnlineGame } = await import("./yaniv-online.js");
      startYanivOnlineGame(roomCode);
    } else {
      const { startOnlineGame } = await import("./online.js");
      startOnlineGame(roomCode);
    }
  } else if (gameType === "yaniv") {
    const { startLocalYaniv } = await import("./yaniv-local.js");
    startLocalYaniv();
  } else if (gameType === "golf") {
    const { startGolf } = await import("./golf-ui.js");
    startGolf();
  } else if (gameType === "dice") {
    const { startDice } = await import("./dice-ui.js");
    startDice();
  } else {
    await import("../../game.js");
    const { setupLobby } = await import("./lobby.js");
    setupLobby({ gameType });
  }
}
