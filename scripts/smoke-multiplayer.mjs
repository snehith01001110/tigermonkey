import assert from "node:assert/strict";

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
  const states = [];
  const waiters = [];

  ws.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    states.push(payload);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(payload)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(payload);
    }
  });

  return {
    ws,
    send(action) {
      ws.send(JSON.stringify({ type: "action", action }));
    },
    waitFor(predicate, timeoutMs = 3_000) {
      const existing = [...states].reverse().find(predicate);
      if (existing) return Promise.resolve(existing);
      return this.waitForNext(predicate, timeoutMs);
    },
    waitForNext(predicate, timeoutMs = 3_000) {
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1);
            reject(new Error(`Timed out waiting for: ${predicate}`));
          }, timeoutMs),
        };
        waiters.push(waiter);
      });
    },
  };
}

const host = await post("/api/rooms", { name: "Ari", gameType: "cabo" });
const hostClient = openClient(host);
await hostClient.waitFor((message) => message.state.status === "waiting");

const guest = await post(`/api/rooms/${host.roomCode}/join`, { name: "Bo" });
const guestClient = openClient(guest);
const connected = (message) => message.state.status === "peeking" && message.connectedPlayerIds.length === 2;
const [hostOpening, guestOpening] = await Promise.all([
  hostClient.waitFor(connected),
  guestClient.waitFor(connected),
]);

const hostOwn = hostOpening.state.players.find((player) => player.id === host.playerId).hand;
const hostOpponent = hostOpening.state.players.find((player) => player.id === guest.playerId).hand;
const guestOwn = guestOpening.state.players.find((player) => player.id === guest.playerId).hand;
assert.deepEqual(hostOwn.map((card) => card.hidden), [true, true, false, false]);
assert.ok(hostOpponent.every((card) => card.hidden));
assert.deepEqual(guestOwn.map((card) => card.hidden), [true, true, false, false]);

hostClient.send({ type: "READY" });
await hostClient.waitFor((message) => message.state.initialReady[host.playerId]);
guestClient.send({ type: "READY" });
const playing = await hostClient.waitFor((message) => message.state.status === "playing");

const currentId = playing.state.currentPlayerId;
const current = currentId === host.playerId ? hostClient : guestClient;
const observer = currentId === host.playerId ? guestClient : hostClient;
const currentCredential = currentId === host.playerId ? host : guest;
const rejectedPromise = observer.waitForNext((message) => message.type === "error" && message.code === "not_your_turn");
observer.send({ type: "DRAW_DECK" });
const rejected = await rejectedPromise;
assert.equal(rejected.code, "not_your_turn");

const currentDrawPromise = current.waitForNext((message) => message.type === "state" && message.state.phase === "drawn");
const observerDrawPromise = observer.waitForNext((message) => message.type === "state" && message.state.phase === "drawn");
current.send({ type: "DRAW_DECK" });
const [currentDraw, observerDraw] = await Promise.all([currentDrawPromise, observerDrawPromise]);
assert.equal(currentDraw.state.drawn.hidden, false);
assert.equal(observerDraw.state.drawn.hidden, true);
assert.equal(Object.hasOwn(observerDraw.state.drawn, "rank"), false);

const replacedPromise = current.waitForNext((message) => message.type === "state" && message.state.currentPlayerId !== currentCredential.playerId);
current.send({ type: "REPLACE", index: 0 });
await replacedPromise;

const disconnectedPromise = observer.waitForNext((message) => message.type === "state" && message.state.status === "playing" && message.connectedPlayerIds.length === 1);
current.ws.close();
await disconnectedPromise;
const pausedPromise = observer.waitForNext((message) => message.type === "error" && message.code === "opponent_disconnected");
observer.send({ type: "DRAW_DECK" });
const paused = await pausedPromise;
assert.equal(paused.code, "opponent_disconnected");

const restoredPromise = observer.waitForNext((message) => message.type === "state" && message.connectedPlayerIds.length === 2);
const reconnected = openClient(currentCredential);
await restoredPromise;
const resumedDrawPromise = observer.waitForNext((message) => message.type === "state" && message.state.phase === "drawn");
observer.send({ type: "DRAW_DECK" });
await resumedDrawPromise;

observer.ws.close();
reconnected.ws.close();
console.log(`Multiplayer smoke test passed for room ${host.roomCode}.`);
