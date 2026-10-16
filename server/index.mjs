#!/usr/bin/env node
// Studio 4000 session server: relays messages between the people in a room.
// It never stores audio or projects; voice and screen go peer to peer over WebRTC.
//
//   node index.mjs [--port 3031] [--host 0.0.0.0]
//
// For sessions over the internet, put it behind an HTTPS reverse proxy and use wss://.

import { createServer } from "node:http";
import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { WebSocketServer } from "ws";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : process.env[name.toUpperCase()] ?? fallback;
};

const PORT = Number(arg("port", 3031));
const HOST = arg("host", "0.0.0.0");
const MAX_PEERS = Number(arg("max-peers", 12));
const MAX_MESSAGE = 8 * 1024 * 1024;

/** @type {Map<string, { password: string, peers: Map<string, Peer>, nextIndex: number }>} */
const rooms = new Map();

/** @typedef {{ id: string, name: string, role: "host" | "guest", index: number, ws: import("ws").WebSocket }} Peer */

const hash = (s) => createHash("sha256").update(String(s)).digest();
const samePassword = (a, b) => timingSafeEqual(hash(a), hash(b));
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastPeers(room) {
  const peers = [...room.peers.values()].map(({ id, name, role, index }) => ({ id, name, role, index }));
  for (const p of room.peers.values()) send(p.ws, { type: "peers", peers });
}

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, peers: [...rooms.values()].reduce((n, r) => n + r.peers.size, 0) }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Studio 4000 session server. Connect with a WebSocket client.\n");
});

const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE });

wss.on("connection", (ws, req) => {
  /** @type {Peer | null} */
  let me = null;
  let roomCode = "";
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (!me) {
      if (msg.type !== "join") return;
      const code = clean(msg.room, 16).toUpperCase();
      const role = msg.role === "host" ? "host" : "guest";
      const name = clean(msg.name, 40) || "Musician";
      const password = String(msg.password ?? "");
      if (!/^[A-Z0-9]{4,16}$/.test(code)) return send(ws, { type: "error", message: "That session code isn't valid" });

      let room = rooms.get(code);
      if (role === "host") {
        if (room && [...room.peers.values()].some((p) => p.role === "host")) return send(ws, { type: "error", message: "That session already has a host" });
        if (!room) { room = { password, peers: new Map(), nextIndex: 0 }; rooms.set(code, room); }
        room.password = password;
      } else {
        if (!room || ![...room.peers.values()].some((p) => p.role === "host")) return send(ws, { type: "error", message: "No live session with that code. Check it with the host." });
        if (room.password && !samePassword(room.password, password)) return send(ws, { type: "error", message: "Wrong session password" });
        if (room.peers.size >= MAX_PEERS) return send(ws, { type: "error", message: "The session is full" });
      }

      me = { id: randomUUID(), name, role, index: room.nextIndex++, ws };
      roomCode = code;
      room.peers.set(me.id, me);
      send(ws, { type: "welcome", id: me.id, index: me.index });
      broadcastPeers(room);
      console.log(`[${new Date().toISOString()}] ${code}: ${name} joined as ${role} from ${req.socket.remoteAddress} (${room.peers.size} in room)`);
      return;
    }

    if (msg.type !== "to") return;
    const room = rooms.get(roomCode);
    if (!room) return;
    const out = { type: "from", from: me.id, data: msg.data };
    if (msg.target === "*" || !msg.target) {
      for (const p of room.peers.values()) if (p.id !== me.id) send(p.ws, out);
    } else {
      const target = room.peers.get(String(msg.target));
      if (target) send(target.ws, out);
    }
  });

  ws.on("close", () => {
    if (!me) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    room.peers.delete(me.id);
    console.log(`[${new Date().toISOString()}] ${roomCode}: ${me.name} left (${room.peers.size} in room)`);
    if (me.role === "host") {
      // The host's engine is the session; without it the room ends.
      for (const p of room.peers.values()) p.ws.close(4000, "The host ended the session");
      rooms.delete(roomCode);
    } else if (room.peers.size === 0) {
      rooms.delete(roomCode);
    } else {
      broadcastPeers(room);
    }
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

wss.on("close", () => clearInterval(heartbeat));

http.listen(PORT, HOST, () => {
  console.log(`Studio 4000 session server listening on ws://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  if (HOST === "0.0.0.0") console.log("Others on your network can join with ws://<this computer's IP>:" + PORT);
});
