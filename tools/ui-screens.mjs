// Captures documentation screenshots of the UI (browser preview mode, mock engine) with headless Edge.
// Needs the UI dev server (npm run dev in ui/) and, for the live-session shot, the relay (node server/index.mjs).
//   node tools/ui-screens.mjs [--ui http://localhost:5173] [--relay ws://127.0.0.1:3031] [--out docs/screenshots]

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const UI = arg("ui", "http://localhost:5173/");
const RELAY = arg("relay", "ws://127.0.0.1:3031");
const OUT = resolve(arg("out", "docs/screenshots"));
const PORT = 9333;
const W = 1440, H = 860;

const edge = [
  `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((p) => existsSync(p));
if (!edge) throw new Error("Microsoft Edge not found");
mkdirSync(OUT, { recursive: true });

const browser = spawn(edge, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmpdir(), "s3-ui-screens")}`,
  `--window-size=${W},${H}`, "--no-first-run", "--mute-audio", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function devtools(path, method = "GET") {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}${path}`, { method })).json(); } catch { await sleep(200); }
  }
  throw new Error("Edge DevTools didn't start");
}

async function openPage() {
  const target = await devtools(`/json/new?about:blank`, "PUT");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    waiting.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const page = {
    async go(url) { await send("Page.navigate", { url }); await sleep(2500); },
    async eval(fn, ...args) {
      const r = await send("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(name) {
      await sleep(700);
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
      console.log(`saved ${name}.png`);
    },
    close: () => ws.close(),
  };
  return page;
}

/** Imports the app's own module instances (the dev server adds ?t= to hot-updated modules). */
const LOAD = async () => {
  const url = (n) => performance.getEntriesByType("resource").map((e) => e.name).find((u) => new URL(u).pathname === `/src/${n}`);
  window.__m = { store: await import(url("store.ts")), collab: await import(url("collab.ts")) };
  return !!window.__m.store;
};
const SET = async (state) => { window.__m.store.useStore.setState(state); await new Promise((r) => setTimeout(r, 500)); };

try {
  const host = await openPage();
  await host.go(UI);
  await host.eval(() => { localStorage.clear(); return true; });
  await host.go(UI);
  await host.shot("welcome");

  await host.eval(LOAD);
  await host.eval(async () => {
    const { act, useStore } = window.__m.store;
    await act("project.new", { name: "Night Drive", template: "vocal", bpm: 92 });
    await new Promise((r) => setTimeout(r, 800));
    const p = useStore.getState().project;
    const vocal = p.tracks.find((t) => /vocal/i.test(t.name));
    const clip = p.tracks.flatMap((t) => t.clips).find((c) => c.kind === "audio");
    useStore.setState({ selectedTrack: vocal?.id ?? null, selectedClips: clip ? [clip.id] : [] });
    return true;
  });
  await host.shot("arrange-preview");

  await host.eval(SET, { bottom: "smart" });
  await host.eval(async () => {
    const btn = [...document.querySelectorAll(".dock button")].find((b) => /analy[sz]e/i.test(b.textContent ?? ""));
    btn?.click();
    await new Promise((r) => setTimeout(r, 900));
    return true;
  });
  await host.shot("smart-mix");

  await host.eval(SET, { bottom: "editor" });
  await host.shot("editor");

  await host.eval(SET, { bottom: "mixer", side: "assistant" });
  await host.shot("assistant");

  await host.eval(SET, { side: null, exportOpen: true });
  await host.shot("export");
  await host.eval(SET, { exportOpen: false, settingsOpen: "agent" });
  await host.shot("settings-agent");
  await host.eval(SET, { settingsOpen: null, paletteOpen: true });
  await host.shot("palette");
  await host.eval(SET, { paletteOpen: false, shortcutsOpen: true });
  await host.shot("shortcuts");
  await host.eval(SET, { shortcutsOpen: false, view: "mixer", side: null });
  await host.shot("mixer");
  await host.eval(SET, { view: "tracks" });

  const room = Math.random().toString(36).slice(2, 8).toUpperCase();
  await host.eval(async (relay, room) => {
    await window.__m.collab.startSession({ server: relay, room, name: "Maya", role: "host" });
    window.__m.store.useStore.setState({ side: "collab" });
    return window.__m.collab.useCollab.getState().status;
  }, RELAY, room);

  const guest = await openPage();
  await guest.go(UI);
  await guest.eval(LOAD);
  await guest.eval(async (relay, room) => {
    const { collab, store } = window.__m;
    await collab.startSession({ server: relay, room, name: "Leo", role: "guest" });
    await new Promise((r) => setTimeout(r, 1500));
    const p = store.useStore.getState().project;
    store.useStore.setState({ selectedTrack: p.tracks[0].id });
    const body = document.querySelector(".arrange-body").getBoundingClientRect();
    document.querySelector(".arrange-inner").dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: body.left + 232 + 380, clientY: body.top + 140 }));
    collab.sendChat("Doubling the chorus vocal now. Punch in at bar 9?");
    collab.setNotes("Verse: tighten the double\nChorus: add harmonies, open up the plate\nBridge: filter sweep into the drop");
    return true;
  }, RELAY, room);
  await sleep(1200);
  await host.eval(async () => {
    window.__m.collab.sendChat("Yes, I'll loop bars 9 to 17 and arm Lead Vocal.");
    return true;
  });
  await host.shot("collab");
  await guest.shot("collab-guest");

  await guest.eval(async () => { await window.__m.collab.leaveSession(); return true; });
  await host.eval(async () => { await window.__m.collab.leaveSession(); return true; });
  guest.close();
  host.close();
} finally {
  browser.kill();
}
