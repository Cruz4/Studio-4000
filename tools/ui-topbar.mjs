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
const PORT = 9348;
const W = 1440, H = 860;

const edge = [
  `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((p) => existsSync(p));
if (!edge) throw new Error("Microsoft Edge not found");
mkdirSync(OUT, { recursive: true });

const browser = spawn(edge, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmpdir(), "s4-topbar-ui")}`,
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
    viewport: (width) => send("Emulation.setDeviceMetricsOverride", { width, height: H, deviceScaleFactor: 1, mobile: false }),
    close: () => ws.close(),
  };
  return page;
}


try {
  const page = await openPage();
  await page.go(UI);
  await page.eval(async () => {
    const url = performance.getEntriesByType("resource").map((e) => e.name).find((u) => new URL(u).pathname === "/src/store.ts");
    const store = await import(url ?? "/src/store.ts");
    await store.act("project.new", { name: "A longer project title for toolbar spacing", template: "vocal" });
    await store.act("recording.loopTakes.configure", { enabled: true, takeCount: 4, mutePrevious: true });
    store.useStore.setState({ aboutOpen: false });
  });
  await sleep(350);
  const results = [];
  for (const theme of ["studio-sessions", "light"]) {
    await page.eval(async (theme) => (await import("/src/theme.ts")).applyPalette(theme), theme);
  for (const width of [1920, 1680, 1600, 1536, 1480, 1440, 1366, 1280]) {
    await page.viewport(width); await sleep(100);
    results.push(await page.eval((width) => {
      const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
      const badge = document.querySelector(".engine-load");
      const badgeText = badge.querySelector("span");
      const command = '.topbar button[title="Commands (Ctrl+K)"]';
      const positions = [];
      for (const value of ["9%", "99%", "100%"]) { badgeText.textContent = value; positions.push(box(command).right); }
      return { width, badge: box(".engine-load"), cpuVisible: getComputedStyle(badge).display !== "none", padding: width - box(command).right,
        stable: new Set(positions).size === 1, left: box(".topbar-side:first-child"), leftControls: box(".topbar-side:first-child .seg"), console: box(".console"), right: box(".topbar-side.right") };
    }, width));
  }
  }
  console.log(JSON.stringify(results, null, 2));
  await page.viewport(1536); await page.shot("topbar-1536");
  await page.viewport(1920); await page.shot("topbar-1920");
  if (!process.argv.includes("--baseline")) for (const r of results) {
    if (r.padding < 12 || !r.stable || r.badge.width > 58 || r.leftControls.right > r.console.left || r.console.right > r.right.left)
      throw new Error("Toolbar spacing failed: " + JSON.stringify(r));
  }
  console.log("TOPBAR CHECKS PASSED");
  page.close();
} finally { browser.kill(); }
