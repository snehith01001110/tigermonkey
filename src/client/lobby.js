import {
  gameTypeFromUrl,
  loadCredential,
  multiplayerApiBase,
  normalizeRoomCode,
  roomUrl,
  saveCredential,
} from "./config.js";

const els = {
  button: document.getElementById("multiplayerBtn"),
  dialog: document.getElementById("multiplayerDialog"),
  title: document.getElementById("multiplayerTitle"),
  close: document.getElementById("closeMultiplayerBtn"),
  form: document.getElementById("multiplayerForm"),
  name: document.getElementById("playerName"),
  create: document.getElementById("createRoomBtn"),
  join: document.getElementById("joinRoomBtn"),
  error: document.getElementById("multiplayerError"),
  waiting: document.getElementById("waitingRoom"),
  waitingMessage: document.getElementById("waitingRoomMessage"),
  copy: document.getElementById("copyInviteBtn"),
};

let initialized = false;
let buttonAttached = false;
let inviteCode = "";
let joinedCallback = null;
let activeGameType = gameTypeFromUrl();

export function setupLobby({ roomCode = "", gameType = gameTypeFromUrl(), autoOpen = false, onJoined = null, attachButton = true } = {}) {
  inviteCode = normalizeRoomCode(roomCode);
  joinedCallback = onJoined;
  activeGameType = gameType;

  if (!initialized) {
    initialized = true;
    els.close.addEventListener("click", closeLobby);
    els.create.addEventListener("click", createRoom);
    els.join.addEventListener("click", joinRoom);
    els.name.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (inviteCode) joinRoom();
      else createRoom();
    });
    els.copy.addEventListener("click", copyInvite);
  }
  if (attachButton && !buttonAttached) {
    buttonAttached = true;
    els.button.addEventListener("click", () => openLobby());
  }

  try { els.name.value = localStorage.getItem("tigermonkey-player-name") || ""; } catch {}
  if (autoOpen) openLobby(inviteCode);
}

export function openLobby(roomCode = inviteCode) {
  inviteCode = normalizeRoomCode(roomCode);
  showForm();
  els.title.textContent = inviteCode ? "join game" : "play together";
  els.create.hidden = Boolean(inviteCode);
  els.join.hidden = !inviteCode;
  if (!els.dialog.open) els.dialog.showModal();
  queueMicrotask(() => els.name.focus());
}

export function showWaitingRoom(roomCode, message = "Waiting for another player…") {
  inviteCode = normalizeRoomCode(roomCode);
  els.form.hidden = true;
  els.waiting.hidden = false;
  els.title.textContent = "room ready";
  els.waitingMessage.textContent = message;
  els.close.hidden = false;
  if (!els.dialog.open) els.dialog.showModal();
}

export function closeLobby() {
  if (els.dialog.open) els.dialog.close();
}

function showForm() {
  els.form.hidden = false;
  els.waiting.hidden = true;
  els.error.hidden = true;
  els.close.hidden = false;
  setBusy(false);
}

async function createRoom() {
  await submit("/api/rooms", {});
}

async function joinRoom() {
  const code = inviteCode;
  if (code.length !== 6) return showError("This invite link is invalid.");
  const existing = loadCredential(code);
  if (existing) return finish(existing);
  await submit(`/api/rooms/${code}/join`, { roomCode: code });
}

async function submit(path, { roomCode = "" }) {
  const name = els.name.value.replace(/\s+/g, " ").trim();
  if (!name) return showError("Enter your name.");
  const apiBase = multiplayerApiBase();
  if (!apiBase) return showError("Online play is not connected to its server yet.");

  setBusy(true);
  try {
    try {
      localStorage.setItem("tigermonkey-player-name", name);
    } catch {}
    const response = await fetch(`${apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, gameType: activeGameType }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not reach that room.");
    const credential = {
      roomCode: normalizeRoomCode(result.roomCode || roomCode),
      playerId: result.playerId,
      token: result.token,
      name,
      gameType: result.summary?.gameType || activeGameType,
    };
    saveCredential(credential);
    finish(credential);
  } catch (error) {
    showError(error instanceof Error ? error.message : "Could not connect.");
  } finally {
    setBusy(false);
  }
}

function finish(credential) {
  if (joinedCallback) joinedCallback(credential);
  else location.assign(roomUrl(credential.roomCode, credential.gameType || activeGameType));
}

async function copyInvite() {
  const text = roomUrl(inviteCode, activeGameType);
  try {
    await navigator.clipboard.writeText(text);
    els.copy.textContent = "link copied";
    setTimeout(() => { els.copy.textContent = "copy invite link"; }, 1400);
  } catch {
    window.prompt("Copy this invite link", text);
  }
}

function setBusy(busy) {
  els.create.disabled = busy;
  els.join.disabled = busy;
  els.name.disabled = busy;
  if (busy) {
    els.error.hidden = true;
    if (!els.create.hidden) els.create.textContent = "creating…";
    els.join.textContent = "joining…";
  } else {
    els.create.textContent = "create a room";
    els.join.textContent = "join game";
  }
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}
