import { roomCodeFromUrl } from "./config.js";
import { setupKeyboardControls } from "./keyboard.js";

const roomCode = roomCodeFromUrl();

setupKeyboardControls();

if (roomCode) {
  const { startOnlineGame } = await import("./online.js");
  startOnlineGame(roomCode);
} else {
  await import("../../game.js");
  const { setupLobby } = await import("./lobby.js");
  setupLobby();
}
