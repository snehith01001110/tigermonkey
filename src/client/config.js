export function multiplayerApiBase() {
  const configured = document.querySelector('meta[name="multiplayer-api"]')?.content.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return "http://localhost:8787";
  return "";
}

export function roomCodeFromUrl() {
  return normalizeRoomCode(new URL(location.href).searchParams.get("room") || "");
}

export function normalizeRoomCode(value) {
  return String(value).toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
}

export function roomUrl(roomCode) {
  const url = new URL(location.href);
  url.search = "";
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
