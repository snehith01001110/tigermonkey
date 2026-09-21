import { gameUrl, loadCredential, multiplayerApiBase, roomUrl } from "./config.js";
import { closeLobby, setupLobby, showWaitingRoom } from "./lobby.js";
import { createScopaTable } from "./scopa-ui.js?v=stable-mobile-selection";

let roomCode = "";
let credential = null;
let socket = null;
let state = null;
let connected = false;
let actionPending = false;
let connectedPlayerIds = [];
let reconnectDelay = 700;
let reconnectTimer = null;
let leaving = false;
let statusOverride = "";
let ui = null;

export function startScopaOnlineGame(code) {
  roomCode = code;
  ui = createScopaTable({ dispatch: sendAction, online: true });

  const multiplayerButton = document.getElementById("multiplayerBtn");
  const closeMultiplayerButton = document.getElementById("closeMultiplayerBtn");
  multiplayerButton.textContent = "leave game";
  multiplayerButton.addEventListener("click", leaveGame);
  closeMultiplayerButton.addEventListener("click", () => {
    if (!state || state.status === "waiting") leaveGame();
  });

  setupLobby({
    roomCode,
    gameType: "scopa",
    attachButton: false,
    onJoined: joined,
  });

  credential = loadCredential(roomCode);
  if (credential) connect();
  else setupLobby({ roomCode, gameType: "scopa", autoOpen: true, attachButton: false, onJoined: joined });

  window.addEventListener("beforeunload", () => {
    leaving = true;
    if (socket) socket.close(1000, "Page closed");
  });
}

function joined(nextCredential) {
  credential = nextCredential;
  closeLobby();
  connect();
}

function connect() {
  const apiBase = multiplayerApiBase();
  if (!apiBase) {
    statusOverride = "Online play is not connected to its server yet.";
    render();
    setupLobby({ roomCode, gameType: "scopa", autoOpen: true, attachButton: false, onJoined: joined });
    return;
  }

  clearTimeout(reconnectTimer);
  const url = new URL(`${apiBase}/api/rooms/${roomCode}/socket`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(url, ["tigermonkey", `token.${credential.token}`]);

  socket.addEventListener("open", () => {
    connected = true;
    actionPending = false;
    statusOverride = "";
    reconnectDelay = 700;
    render();
  });

  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "state") {
        if (payload.state.gameType !== "scopa") {
          location.replace(roomUrl(roomCode, payload.state.gameType));
          return;
        }
        state = payload.state;
        connectedPlayerIds = payload.connectedPlayerIds || [];
        actionPending = false;
        statusOverride = "";
        if (state.status === "waiting") showWaitingRoom(roomCode);
        else closeLobby();
        render();
      } else if (payload.type === "error") {
        actionPending = false;
        statusOverride = payload.message || "That move could not be completed.";
        render();
      }
    } catch {
      statusOverride = "The room sent an unreadable update.";
      render();
    }
  });

  socket.addEventListener("close", (event) => {
    connected = false;
    actionPending = false;
    render();
    if (leaving) return;
    if (event.code === 4000) {
      statusOverride = "This room has expired.";
      render();
      return;
    }
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
  });

  socket.addEventListener("error", () => {
    connected = false;
    render();
  });
}

function sendAction(action) {
  if (!connected || actionPending || socket?.readyState !== WebSocket.OPEN) return;
  actionPending = true;
  statusOverride = "";
  socket.send(JSON.stringify({ type: "action", action }));
  render();
}

function render() {
  const meta = {
    connected,
    busy: actionPending,
    connectedPlayerIds,
    message: statusOverride,
  };
  if (state) ui.render(state, meta);
  else ui.renderEmpty(statusOverride || (connected ? "Waiting for the room…" : "Connecting to the room…"));
}

function leaveGame() {
  leaving = true;
  clearTimeout(reconnectTimer);
  if (socket) socket.close(1000, "Left game");
  location.assign(gameUrl("scopa"));
}
