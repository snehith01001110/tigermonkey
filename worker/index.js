import { DurableObject } from "cloudflare:workers";

import { GameRuleError } from "../src/shared/games/cabo.js";
import { getGameModule, supportedGameTypes } from "../src/shared/games/registry.js";

const ROOM_CODE_LENGTH = 6;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 2_048;
const TOKEN_PROTOCOL_PREFIX = "token.";

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          value TEXT NOT NULL
        )
      `);
    });
  }

  async create(roomCode, gameType, player, tokenHash) {
    if (this.loadRoom()) return { ok: false, code: "room_exists" };
    const gameModule = getGameModule(gameType);
    const room = {
      gameType,
      game: gameModule.create({ roomCode, host: player }),
      credentials: { [player.id]: tokenHash },
    };
    this.saveRoom(room);
    await this.touch();
    return { ok: true, summary: roomSummary(room) };
  }

  async join(player, tokenHash) {
    const room = this.loadRoom();
    if (!room) return { ok: false, code: "room_not_found" };
    if (room.game.players.length >= 2) return { ok: false, code: "room_full" };
    const gameModule = getGameModule(room.gameType);
    gameModule.addPlayer(room.game, player, randomTools());
    room.credentials[player.id] = tokenHash;
    this.saveRoom(room);
    await this.touch();
    this.broadcast(room);
    return { ok: true, summary: roomSummary(room) };
  }

  summary() {
    const room = this.loadRoom();
    return room ? { ok: true, summary: roomSummary(room) } : { ok: false, code: "room_not_found" };
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return jsonResponse({ error: "Expected a WebSocket upgrade." }, 426);
    }

    const room = this.loadRoom();
    if (!room) return jsonResponse({ error: "Room not found." }, 404);

    const protocols = parseProtocols(request.headers.get("Sec-WebSocket-Protocol"));
    const suppliedToken = protocols.find((protocol) => protocol.startsWith(TOKEN_PROTOCOL_PREFIX))?.slice(TOKEN_PROTOCOL_PREFIX.length);
    if (!suppliedToken) return jsonResponse({ error: "Missing room credential." }, 401);

    const playerId = await playerIdForToken(room, suppliedToken);
    if (!playerId) return jsonResponse({ error: "Invalid room credential." }, 401);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ playerId });
    this.ctx.acceptWebSocket(server, [`player:${playerId}`]);
    this.sendView(server, room, playerId);
    this.broadcast(room);

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": "tigermonkey" },
    });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > MAX_BODY_BYTES) {
      return this.sendError(ws, "That message is not valid.");
    }

    const attachment = ws.deserializeAttachment();
    const playerId = attachment?.playerId;
    if (typeof playerId !== "string") return this.sendError(ws, "Your room session is invalid.", "unauthorized");

    try {
      const payload = JSON.parse(message);
      if (!payload || payload.type !== "action" || !isPlainObject(payload.action)) {
        throw new GameRuleError("That message is not a game action.");
      }
      const room = this.loadRoom();
      if (!room) throw new GameRuleError("This room has expired.", "room_expired");
      const connected = new Set(this.connectedPlayerIds());
      if (room.game.players.length === 2 && room.game.players.some((player) => !connected.has(player.id))) {
        throw new GameRuleError("Waiting for the other player to reconnect.", "opponent_disconnected");
      }
      const gameModule = getGameModule(room.gameType);
      gameModule.applyAction(room.game, playerId, payload.action, randomTools());
      this.saveRoom(room);
      await this.touch();
      this.broadcast(room);
    } catch (error) {
      if (error instanceof GameRuleError) return this.sendError(ws, error.message, error.code);
      console.error(JSON.stringify({ message: "websocket action failed", error: errorMessage(error) }));
      return this.sendError(ws, "The move could not be completed.", "server_error");
    }
  }

  webSocketClose(ws) {
    const room = this.loadRoom();
    if (room) this.broadcast(room, ws);
  }

  webSocketError(ws, error) {
    console.error(JSON.stringify({ message: "room websocket error", error: errorMessage(error) }));
    const room = this.loadRoom();
    if (room) this.broadcast(room, ws);
  }

  async alarm() {
    for (const ws of this.ctx.getWebSockets()) ws.close(4000, "Room expired");
    this.ctx.storage.sql.exec("DELETE FROM room_state");
  }

  loadRoom() {
    const row = this.ctx.storage.sql.exec("SELECT value FROM room_state WHERE singleton = 1").toArray()[0];
    return row ? JSON.parse(row.value) : null;
  }

  saveRoom(room) {
    this.ctx.storage.sql.exec(
      "INSERT INTO room_state (singleton, value) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET value = excluded.value",
      JSON.stringify(room),
    );
  }

  async touch() {
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  connectedPlayerIds(excludedSocket = null) {
    const ids = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excludedSocket) continue;
      const playerId = ws.deserializeAttachment()?.playerId;
      if (typeof playerId === "string") ids.add(playerId);
    }
    return [...ids];
  }

  sendView(ws, room, playerId, connectedPlayerIds = this.connectedPlayerIds()) {
    const gameModule = getGameModule(room.gameType);
    ws.send(
      JSON.stringify({
        type: "state",
        state: gameModule.viewForPlayer(room.game, playerId),
        connectedPlayerIds,
      }),
    );
  }

  broadcast(room, excludedSocket = null) {
    const connectedPlayerIds = this.connectedPlayerIds(excludedSocket);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excludedSocket) continue;
      const playerId = ws.deserializeAttachment()?.playerId;
      if (typeof playerId !== "string") continue;
      try {
        this.sendView(ws, room, playerId, connectedPlayerIds);
      } catch (error) {
        console.error(JSON.stringify({ message: "state broadcast failed", error: errorMessage(error) }));
      }
    }
  }

  sendError(ws, message, code = "invalid_action") {
    try {
      ws.send(JSON.stringify({ type: "error", message, code }));
    } catch {}
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (!originAllowed(origin, env.ALLOWED_ORIGINS)) {
      return jsonResponse({ error: "Origin not allowed." }, 403);
    }

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    try {
      let response;
      if (request.method === "GET" && url.pathname === "/health") {
        response = jsonResponse({ ok: true, games: supportedGameTypes() });
      } else if (request.method === "POST" && url.pathname === "/api/rooms") {
        response = await createRoom(request, env);
      } else {
        const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|socket))?$/);
        response = match ? await handleRoomRequest(request, env, match[1], match[2]) : jsonResponse({ error: "Not found." }, 404);
      }
      return response.status === 101 ? response : withCors(response, origin);
    } catch (error) {
      if (error instanceof HttpError) return withCors(jsonResponse({ error: error.message }, error.status), origin);
      console.error(JSON.stringify({ message: "request failed", path: url.pathname, error: errorMessage(error) }));
      return withCors(jsonResponse({ error: "Internal server error." }, 500), origin);
    }
  },
};

async function createRoom(request, env) {
  const body = await readJson(request);
  const name = cleanName(body.name);
  const gameType = typeof body.gameType === "string" ? body.gameType : "cabo";
  if (!supportedGameTypes().includes(gameType)) throw new HttpError(400, "That game is not supported.");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const roomCode = randomRoomCode();
    const playerId = crypto.randomUUID();
    const token = randomToken();
    const tokenHash = await hashToken(token);
    const stub = env.GAME_ROOMS.getByName(roomCode);
    const result = await stub.create(roomCode, gameType, { id: playerId, name }, tokenHash);
    if (result.ok) return jsonResponse({ roomCode, playerId, token, summary: result.summary }, 201);
  }
  throw new HttpError(503, "Could not create a room. Please try again.");
}

async function handleRoomRequest(request, env, roomCode, action) {
  const stub = env.GAME_ROOMS.getByName(roomCode);

  if (action === "socket") {
    if (request.method !== "GET") return jsonResponse({ error: "Method not allowed." }, 405);
    return stub.fetch(request);
  }

  if (action === "join") {
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
    const body = await readJson(request);
    const name = cleanName(body.name);
    const playerId = crypto.randomUUID();
    const token = randomToken();
    const tokenHash = await hashToken(token);
    const result = await stub.join({ id: playerId, name }, tokenHash);
    if (!result.ok) return roomError(result.code);
    return jsonResponse({ roomCode, playerId, token, summary: result.summary });
  }

  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed." }, 405);
  const result = await stub.summary();
  if (!result.ok) return roomError(result.code);
  return jsonResponse(result.summary);
}

function roomSummary(room) {
  return {
    roomCode: room.game.roomCode,
    gameType: room.gameType,
    status: room.game.status,
    players: room.game.players.map((player) => ({ id: player.id, name: player.name })),
  };
}

function roomError(code) {
  if (code === "room_not_found") return jsonResponse({ error: "Room not found." }, 404);
  if (code === "room_full") return jsonResponse({ error: "That room is full." }, 409);
  return jsonResponse({ error: "The room is unavailable." }, 409);
}

async function readJson(request) {
  if (!request.body) throw new HttpError(400, "A JSON body is required.");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!isPlainObject(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new HttpError(400, "The request body must be valid JSON.");
  }
}

function cleanName(value) {
  if (typeof value !== "string") throw new HttpError(400, "Enter your name.");
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  const shortened = [...clean].slice(0, 20).join("");
  if (!shortened) throw new HttpError(400, "Enter your name.");
  return shortened;
}

function randomTools() {
  return { idFactory: () => crypto.randomUUID(), randomInt: secureRandomInt };
}

function secureRandomInt(max) {
  if (!Number.isInteger(max) || max <= 0) throw new RangeError("max must be a positive integer");
  const range = 0x1_0000_0000;
  const ceiling = Math.floor(range / max) * max;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value);
  while (value[0] >= ceiling);
  return value[0] % max;
}

function randomRoomCode() {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) code += ROOM_ALPHABET[secureRandomInt(ROOM_ALPHABET.length)];
  return code;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function playerIdForToken(room, suppliedToken) {
  const suppliedHash = await hashToken(suppliedToken);
  const suppliedBytes = new TextEncoder().encode(suppliedHash);
  for (const [playerId, expectedHash] of Object.entries(room.credentials)) {
    const expectedBytes = new TextEncoder().encode(expectedHash);
    if (crypto.subtle.timingSafeEqual(suppliedBytes, expectedBytes)) return playerId;
  }
  return null;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parseProtocols(header) {
  return (header || "").split(",").map((value) => value.trim()).filter(Boolean);
}

function originAllowed(origin, configured) {
  if (!origin) return true;
  return String(configured || "").split(",").map((value) => value.trim()).includes(origin);
}

function withCors(response, origin) {
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  headers.append("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonResponse(value, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
