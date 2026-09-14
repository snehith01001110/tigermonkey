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
            reject(new Error("Timed out waiting for Yaniv state."));
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

const host = await post("/api/rooms", { name: "Ari", gameType: "yaniv" });
assert.equal(host.summary.gameType, "yaniv");
const hostClient = openClient(host);
await hostClient.waitFor((message) => message.state?.status === "waiting");

const guest = await post(`/api/rooms/${host.roomCode}/join`, { name: "Bo" });
const guestClient = openClient(guest);
const connected = (message) => message.state?.status === "playing" && message.connectedPlayerIds.length === 2;
const [hostState, guestState] = await Promise.all([
  hostClient.waitFor(connected),
  guestClient.waitFor(connected),
]);

const hostOwn = hostState.state.players.find((player) => player.id === host.playerId).hand;
const hostOpponent = hostState.state.players.find((player) => player.id === guest.playerId).hand;
const guestOwn = guestState.state.players.find((player) => player.id === guest.playerId).hand;
assert.equal(hostOwn.length, 5);
assert.ok(hostOwn.every((card) => !card.hidden && card.rank));
assert.ok(hostOpponent.every((card) => card.hidden && !Object.hasOwn(card, "rank")));
assert.ok(guestOwn.every((card) => !card.hidden && card.rank));

const currentId = hostState.state.currentPlayerId;
const current = currentId === host.playerId ? hostClient : guestClient;
const observer = currentId === host.playerId ? guestClient : hostClient;

const selectedForCurrent = current.waitForNext((message) => message.state?.selectedIndices?.includes(0));
const selectedForObserver = observer.waitForNext((message) => message.state?.revision > hostState.state.revision);
current.send({ type: "TOGGLE_CARD", index: 0 });
const [, observerSelection] = await Promise.all([selectedForCurrent, selectedForObserver]);
assert.deepEqual(observerSelection.state.selectedIndices, []);

const played = current.waitForNext((message) => message.state?.phase === "await-draw");
current.send({ type: "PLAY_SELECTED" });
const playedState = await played;
assert.equal(playedState.state.pendingDiscard.length, 1);

const turnEnded = current.waitForNext((message) => message.state?.currentPlayerId !== currentId);
current.send({ type: "DRAW_DECK" });
await turnEnded;

hostClient.ws.close();
guestClient.ws.close();
console.log(`Yaniv multiplayer smoke test passed for room ${host.roomCode}.`);
