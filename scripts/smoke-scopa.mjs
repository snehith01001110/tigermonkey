import assert from "node:assert/strict";

import { captureOptions } from "../src/shared/games/scopa.js";

const apiBase = process.env.TIGERMONKEY_API || "http://localhost:8787";

async function post(path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:8000" },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  assert.equal(response.ok, true, value.error || `Request failed with ${response.status}`);
  return value;
}

function openClient(credential) {
  const url = new URL(`${apiBase}/api/rooms/${credential.roomCode}/socket`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url, ["tigermonkey", `token.${credential.token}`]);
  const messages = [];
  const waiters = [];

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(message)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  });

  return {
    ws,
    send(action) {
      ws.send(JSON.stringify({ type: "action", action }));
    },
    waitFor(predicate, timeoutMs = 3_000) {
      const existing = [...messages].reverse().find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1);
            reject(new Error("Timed out waiting for Scopa state."));
          }, timeoutMs),
        };
        waiters.push(waiter);
      });
    },
    waitForNext(predicate, timeoutMs = 3_000) {
      const previousCount = messages.length;
      return this.waitFor((message) => messages.indexOf(message) >= previousCount && predicate(message), timeoutMs);
    },
  };
}

function assertPrivateHand(message, ownId, opponentId) {
  const own = message.state.players.find((player) => player.id === ownId).hand;
  const opponent = message.state.players.find((player) => player.id === opponentId).hand;
  assert.ok(own.every((card) => !card.hidden && card.rank && card.suit));
  assert.ok(opponent.every((card) => card.hidden && !Object.hasOwn(card, "rank") && !Object.hasOwn(card, "suit")));
}

const host = await post("/api/rooms", { name: "Ari", gameType: "scopa" });
assert.equal(host.summary.gameType, "scopa");
const hostClient = openClient(host);
await hostClient.waitFor((message) => message.state?.status === "waiting");

const guest = await post(`/api/rooms/${host.roomCode}/join`, { name: "Bo" });
const guestClient = openClient(guest);
const connected = (message) => message.state?.status === "playing" && message.connectedPlayerIds.length === 2;
let [hostView, guestView] = await Promise.all([
  hostClient.waitFor(connected),
  guestClient.waitFor(connected),
]);

assert.equal(hostView.state.deckCount, 30);
assert.equal(hostView.state.table.length, 4);
assert.equal(hostView.state.players.find((player) => player.id === host.playerId).hand.length, 3);
assertPrivateHand(hostView, host.playerId, guest.playerId);
assertPrivateHand(guestView, guest.playerId, host.playerId);

let plays = 0;
while (hostView.state.status === "playing") {
  assert.ok(plays < 40, "A Scopa round should finish after 36 plays.");
  const revision = hostView.state.revision;
  const currentId = hostView.state.currentPlayerId;
  const currentClient = currentId === host.playerId ? hostClient : guestClient;
  const currentView = currentId === host.playerId ? hostView.state : guestView.state;
  const own = currentView.players.find((player) => player.id === currentId);
  const options = captureOptions(currentView.table, own.hand[0]);
  const action = { type: "PLAY_CARD", handIndex: 0, captureIds: options[0] || [] };
  const nextHost = hostClient.waitForNext((message) => message.state?.revision > revision);
  const nextGuest = guestClient.waitForNext((message) => message.state?.revision > revision);
  currentClient.send(action);
  [hostView, guestView] = await Promise.all([nextHost, nextGuest]);
  plays += 1;
}

assert.equal(plays, 36);
assert.equal(hostView.state.status, "round-finished");
assert.equal(hostView.state.deckCount, 0);
assert.equal(hostView.state.table.length, 0);
assert.equal(hostView.state.players.flatMap((player) => player.hand).length, 0);
assert.equal(hostView.state.players.reduce((total, player) => total + player.captured.length, 0), 40);
assert.ok(hostView.state.roundBreakdown);
assert.ok(hostView.state.roundScores);

let revision = hostView.state.revision;
let nextHost = hostClient.waitForNext((message) => message.state?.revision > revision);
let nextGuest = guestClient.waitForNext((message) => message.state?.revision > revision);
hostClient.send({ type: "READY_NEXT" });
[hostView, guestView] = await Promise.all([nextHost, nextGuest]);

revision = hostView.state.revision;
nextHost = hostClient.waitForNext((message) => message.state?.revision > revision);
nextGuest = guestClient.waitForNext((message) => message.state?.revision > revision);
guestClient.send({ type: "READY_NEXT" });
[hostView, guestView] = await Promise.all([nextHost, nextGuest]);

assert.equal(hostView.state.status, "playing");
assert.equal(hostView.state.roundNumber, 2);
assertPrivateHand(hostView, host.playerId, guest.playerId);
assertPrivateHand(guestView, guest.playerId, host.playerId);

hostClient.ws.close();
guestClient.ws.close();
console.log(`Scopa multiplayer smoke test passed for room ${host.roomCode}.`);
