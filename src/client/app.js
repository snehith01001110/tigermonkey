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

const topActionsWrap = document.getElementById("topActionsWrap");
const menuButton = document.getElementById("menuButton");

function setGameMenuOpen(open) {
  gameMenu.hidden = !open;
  gameMenuButton.setAttribute("aria-expanded", String(open));
  if (open) setActionsMenuOpen(false);
}

/* On narrow screens the top actions collapse behind one button, so the header never
   runs past the edge. On wide screens the class is inert and the row stays visible. */
function setActionsMenuOpen(open) {
  topActionsWrap.classList.toggle("open", open);
  menuButton.setAttribute("aria-expanded", String(open));
}

gameMenuButton.addEventListener("click", () => setGameMenuOpen(gameMenu.hidden));
menuButton.addEventListener("click", () => setActionsMenuOpen(!topActionsWrap.classList.contains("open")));
topActionsWrap.addEventListener("click", (event) => {
  if (event.target !== menuButton && !menuButton.contains(event.target)) setActionsMenuOpen(false);
});
document.addEventListener("click", (event) => {
  if (!gamePicker.contains(event.target)) setGameMenuOpen(false);
  if (!topActionsWrap.contains(event.target)) setActionsMenuOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (topActionsWrap.classList.contains("open")) {
    setActionsMenuOpen(false);
    menuButton.focus();
  }
  if (gameMenu.hidden) return;
  setGameMenuOpen(false);
  gameMenuButton.focus();
});

/* The table sizes its cards from the space the header and dock leave behind, so a game
   fits the screen instead of scrolling. Both are text, so measuring them can't loop. */
function trackPlayArea() {
  const topbar = gameApp.querySelector(".topbar");
  const dock = gameApp.querySelector(".dock");
  const table = gameApp.querySelector(".table");
  if (!topbar || !dock || !table) return;

  let lastChrome = null;
  let lastWidth = null;
  const measure = () => {
    const chrome = Math.ceil(topbar.getBoundingClientRect().bottom + dock.getBoundingClientRect().height);
    const width = Math.floor(table.getBoundingClientRect().width);
    if (chrome !== lastChrome && chrome > 0) {
      lastChrome = chrome;
      document.documentElement.style.setProperty("--chrome-h", `${chrome}px`);
    }
    if (width !== lastWidth && width > 0) {
      lastWidth = width;
      document.documentElement.style.setProperty("--table-w", `${width}px`);
    }
  };

  const observer = new ResizeObserver(() => requestAnimationFrame(measure));
  observer.observe(topbar);
  observer.observe(dock);
  observer.observe(table);
  window.addEventListener("resize", measure);
  window.addEventListener("orientationchange", measure);
  measure();
}

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
  trackPlayArea();
  document.getElementById("rulesTitle").textContent = game?.name || gameType;

  gameMenuButton.disabled = Boolean(roomCode && supportsMultiplayer);
  if (roomCode && supportsMultiplayer) gameMenuButton.title = "Leave the room before changing games";
  for (const rules of document.querySelectorAll("[data-rules-for]")) rules.hidden = rules.dataset.rulesFor !== gameType;

  if (gameType !== "dice") setupKeyboardControls();

  if (roomCode && supportsMultiplayer) {
    if (gameType === "yaniv") {
      const { startYanivOnlineGame } = await import("./yaniv-online.js?v=stable-mobile-selection");
      startYanivOnlineGame(roomCode);
    } else if (gameType === "scopa") {
      const { startScopaOnlineGame } = await import("./scopa-online.js?v=stable-mobile-selection");
      startScopaOnlineGame(roomCode);
    } else {
      const { startOnlineGame } = await import("./online.js?v=stable-mobile-selection");
      startOnlineGame(roomCode);
    }
  } else if (gameType === "yaniv") {
    const { startLocalYaniv } = await import("./yaniv-local.js?v=stable-mobile-selection");
    startLocalYaniv();
  } else if (gameType === "scopa") {
    const { startLocalScopa } = await import("./scopa-local.js?v=stable-mobile-selection");
    startLocalScopa();
  } else if (gameType === "golf") {
    const { startGolf } = await import("./golf-ui.js?v=stable-mobile-selection");
    startGolf();
  } else if (gameType === "dice") {
    const { startDice } = await import("./dice-ui.js");
    startDice();
  } else {
    await import("../../game.js?v=stable-mobile-selection");
    const { setupLobby } = await import("./lobby.js");
    setupLobby({ gameType });
  }
}
