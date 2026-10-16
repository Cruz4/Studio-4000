// Smoke test: node smoke.mjs (starts its own server on a spare port)
import { spawn } from "node:child_process";
import { WebSocket } from "ws";

const port = 3990 + Math.floor(Math.random() * 9);
const srv = spawn(process.execPath, ["index.mjs", "--port", String(port), "--host", "127.0.0.1"], { cwd: new URL(".", import.meta.url), stdio: "pipe" });
await new Promise((r) => srv.stdout.once("data", r));

const open = (hello) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox = [];
  ws.on("message", (m) => inbox.push(JSON.parse(m.toString())));
  ws.on("open", () => { ws.send(JSON.stringify({ type: "join", ...hello })); setTimeout(() => resolve({ ws, inbox }), 150); });
  ws.on("error", reject);
});
const fail = (msg) => { console.error("FAIL:", msg); srv.kill(); process.exit(1); };

const host = await open({ room: "ABC234", name: "Host", role: "host", password: "pw" });
const wrong = await open({ room: "ABC234", name: "Bad", role: "guest", password: "nope" });
const guest = await open({ room: "ABC234", name: "Guest", role: "guest", password: "pw" });
const missing = await open({ room: "ZZZ999", name: "Lost", role: "guest" });

if (host.inbox[0]?.type !== "welcome") fail("host not welcomed");
if (wrong.inbox[0]?.type !== "error") fail("wrong password accepted");
if (missing.inbox[0]?.type !== "error") fail("joined a room with no host");
const guestId = guest.inbox.find((m) => m.type === "welcome")?.id;
const peers = host.inbox.filter((m) => m.type === "peers").at(-1)?.peers ?? [];
if (peers.length !== 2) fail(`expected 2 peers, got ${peers.length}`);

host.ws.send(JSON.stringify({ type: "to", target: guestId, data: { kind: "project", project: { name: "x" } } }));
guest.ws.send(JSON.stringify({ type: "to", target: "*", data: { kind: "rpc", id: 1, method: "track.add" } }));
await new Promise((r) => setTimeout(r, 150));
if (!guest.inbox.some((m) => m.type === "from" && m.data.kind === "project")) fail("direct message not relayed");
if (!host.inbox.some((m) => m.type === "from" && m.data.kind === "rpc" && m.from === guestId)) fail("broadcast not relayed");

const closed = new Promise((r) => guest.ws.on("close", (code) => r(code)));
host.ws.close();
const code = await Promise.race([closed, new Promise((r) => setTimeout(() => r("timeout"), 2000))]);
if (code !== 4000) fail(`guest not closed when host left (${code})`);

console.log("session server smoke test passed");
srv.kill();
process.exit(0);
