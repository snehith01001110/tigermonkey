import { roomCodeFromUrl } from "./config.js";

const roomCode = roomCodeFromUrl();

if (roomCode) {
  const { startOnlineGame } = await import("./online.js");
  startOnlineGame(roomCode);
} else {
  await import("../../game.js");
  const { setupLobby } = await import("./lobby.js");
  setupLobby();
}
