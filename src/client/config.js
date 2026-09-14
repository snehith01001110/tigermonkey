import { isGameType } from "./games.js";

export function multiplayerApiBase() {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return "http://localhost:8787";
  const configured = document.querySelector('meta[name="multiplayer-api"]')?.content.trim();
  if (configured) return configured.replace(/\/$/, "");
  return "";
}

export function roomCodeFromUrl() {
  return normalizeRoomCode(new URL(location.href).searchParams.get("room") || "");
}

export function gameTypeFromUrl() {
  return selectedGameTypeFromUrl() || "cabo";
}

export function selectedGameTypeFromUrl() {
  const value = new URL(location.href).searchParams.get("game");
  return isGameType(value) ? value : null;
}

export function normalizeRoomCode(value) {
  return String(value).toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
}

export function gameUrl(gameType) {
  const url = new URL(location.href);
  url.search = "";
  if (isGameType(gameType)) url.searchParams.set("game", gameType);
  url.hash = "";
  return url.toString();
}

export function roomUrl(roomCode, gameType = gameTypeFromUrl()) {
  const url = new URL(location.href);
  url.search = "";
  if (isGameType(gameType)) url.searchParams.set("game", gameType);
  url.searchParams.set("room", normalizeRoomCode(roomCode));
  url.hash = "";
  return url.toString();
}

export function credentialKey(roomCode) {
  return `tigermonkey-room-${normalizeRoomCode(roomCode)}`;
}

export function saveCredential(credential) {
  localStorage.setItem(credentialKey(credential.roomCode), JSON.stringify(credential));
}

export function loadCredential(roomCode) {
  try {
    const value = JSON.parse(localStorage.getItem(credentialKey(roomCode)) || "null");
    if (value?.roomCode === roomCode && typeof value.token === "string" && typeof value.playerId === "string") return value;
  } catch {}
  return null;
}
