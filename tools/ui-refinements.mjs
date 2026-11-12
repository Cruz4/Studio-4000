// Captures documentation screenshots of the UI (browser preview mode, mock engine) with headless Edge.
// Needs the UI dev server (npm run dev in ui/) and, for the live-session shot, the relay (node server/index.mjs).
//   node tools/ui-screens.mjs [--ui http://localhost:5173] [--relay ws://127.0.0.1:3031] [--out docs/screenshots]

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const UI = arg("ui", "http://127.0.0.1:5174/");
const RELAY = arg("relay", "ws://127.0.0.1:3031");
const OUT = resolve(arg("out", "ui-smoke"));
const PORT = 9347;
const W = 1440, H = 860;

const edge = [
  `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((p) => existsSync(p));
if (!edge) throw new Error("Microsoft Edge not found");
mkdirSync(OUT, { recursive: true });

const browser = spawn(edge, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmpdir(), "s4-refinement-ui")}`,
  `--window-size=${W},${H}`, "--no-first-run", "--mute-audio", "about:blank",
], { stdio: "ignore", windowsHide: true });

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


try {
  const page = await openPage();
  await page.go(UI);
  await page.shot("initial");
  console.log(await page.eval(() => ({ url: location.href, text: document.body.innerText.slice(0, 1000), resources: performance.getEntriesByType("resource").map((e) => e.name).slice(0, 10) })));
  const setup = await page.eval(async () => {
    const url = performance.getEntriesByType("resource").map((e) => e.name).find((u) => new URL(u).pathname === "/src/store.ts");
    window.__test = { store: await import(url ?? "/src/store.ts"), theme: await import("/src/theme.ts") };
    const { store } = window.__test;
    await store.act("project.new", { name: "Refinement checks", template: "vocal", bpm: 92 });
    await new Promise((r) => setTimeout(r, 300));
    store.useStore.setState({ aboutOpen: false, settingsOpen: null, side: null, bottom: "mixer" });
    await store.act("marker.add", { time: 2.37, name: "Verse" });
    return store.useStore.getState().project.tracks.length;
  });
  if (!setup) throw new Error("No fixture tracks");
  await page.shot("default-dark");
  const geometry = await page.eval(async () => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
    const cpu = document.querySelector(".engine-load");
    const text = cpu.querySelector("span");
    text.textContent = "9%"; const single = box(cpu.nextElementSibling);
    text.textContent = "99%"; const double = box(cpu.nextElementSibling);
    const marker = box(document.querySelector(".marker-line"));
    const track = box(document.querySelector(".lane"));
    return { single, double, marker, track };
  });
  if (geometry.single.left !== geometry.double.left) throw new Error("CPU badge moves the toolbar");
  if (geometry.marker.height <= geometry.track.height * 2) throw new Error("Marker does not span the tracks");
  const drag = await page.eval(async () => {
    const st = window.__test.store.useStore.getState();
    const clip = document.querySelector(".clip[data-clip] .clip-label");
    if (!clip) throw new Error("No audio clip to duplicate");
    const owner = clip.closest("[data-clip]");
    const id = owner.dataset.clip; const initial = owner.getBoundingClientRect().left;
    const rect = clip.getBoundingClientRect(); const x = rect.left + 65, y = rect.top + 8;
    clip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y, altKey: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, buttons: 1, clientX: x + 120, clientY: y, altKey: true }));
    await new Promise((r) => setTimeout(r, 150));
    const originals = [...document.querySelectorAll('[data-clip="' + id + '"]')];
    const positions = originals.map((el) => el.getBoundingClientRect().left);
    return { id, initial, positions, x: x + 120, y };
  });
  if (drag.positions.length !== 2 || !drag.positions.includes(drag.initial) || Math.max(...drag.positions) <= drag.initial) throw new Error("Alt-drag must show original plus moved ghost: " + JSON.stringify(drag));
  await page.shot("alt-drag-ghost");
  const drop = await page.eval(async (drag) => {
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: drag.x, clientY: drag.y, altKey: true }));
    await new Promise((r) => setTimeout(r, 500));
    return { ghosts: document.querySelectorAll(".duplicate-ghost").length, clips: document.querySelectorAll(".clip[data-clip]").length };
  }, drag);
  if (drop.ghosts) throw new Error("Duplicate ghost remains after drop");
  await page.shot("duplicate-dropped");
  await page.eval(() => { window.__test.theme.applyPalette("plotting"); window.__test.store.useStore.setState({ settingsOpen: "general" }); });
  await page.shot("plotting-settings");
  const count = await page.eval(() => [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.text === "Plotting (Default)"))?.options.length);
  if (count !== 37) throw new Error("Expected 35 palettes plus default Light/Dark");
  for (const name of ["breeze-candy", "studio-sessions", "lilac-smoke", "neon-midnight"]) {
    await page.eval((name) => { window.__test.theme.applyPalette(name); window.__test.store.useStore.setState({ settingsOpen: null }); }, name);
    await page.shot(name);
  }
  await page.eval(() => window.__test.theme.toggleTheme());
  const toggle = await page.eval(() => ({ mode: document.documentElement.dataset.theme, palette: document.documentElement.dataset.palette ?? null }));
  if (toggle.mode !== "light" || toggle.palette !== null) throw new Error("Toolbar toggle must select default Light");
  await page.shot("default-light");
  console.log(JSON.stringify({ geometry, drag, drop, themes: count, toggle }, null, 2));
  console.log("UI REFINEMENT CHECKS PASSED");
  page.close();
} finally { browser.kill(); }
