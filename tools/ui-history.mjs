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
const PORT = 9351;
const W = 1440, H = 860;

const edge = [
  `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((p) => existsSync(p));
if (!edge) throw new Error("Microsoft Edge not found");
mkdirSync(OUT, { recursive: true });

const browser = spawn(edge, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmpdir(), "s4-history-ui")}`,
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
 const page=await openPage(); await page.go(UI);
 await page.eval(async()=>{
  const urls=performance.getEntriesByType("resource").map(e=>e.name);
  const store=await import(urls.find(u=>new URL(u).pathname==="/src/store.ts"));
  const bridge=await import(urls.find(u=>new URL(u).pathname==="/src/bridge.ts"));
  const theme=await import("/src/theme.ts"); window.__test={store,bridge,theme,jumps:[]};
  await store.act("project.new",{name:"History checks",template:"vocal"});
  store.useStore.setState({aboutOpen:false,bottom:null});
  bridge.setRpcOverride((method,params)=>{
   if(method==="edit.history")return Promise.resolve({undo:Array.from({length:44},(_,i)=>["Effects on","", "   ","New track","A long recording edit label with more detail than the dropdown can fit"][i%5]),redo:["Clip gain", "", "New track"]});
   if(method==="edit.jump"){window.__test.jumps.push(params.steps);return Promise.resolve(true);}
   return null;
  });
  document.querySelector("[data-history-toggle]").click();
 });
 await sleep(350);
 const long=await page.eval(()=>({rows:[...document.querySelectorAll(".history-item")].map(e=>({name:e.querySelector(".history-name").textContent,height:e.getBoundingClientRect().height})),scroll:document.querySelector(".history-list").scrollHeight>document.querySelector(".history-list").clientHeight}));
 if(long.rows.length!==47||long.rows.some(r=>!r.name.trim()||r.height<36)||!long.scroll)throw new Error(JSON.stringify(long));
 await page.shot("history-dark-long");
 await page.eval(()=>{document.querySelectorAll(".history-item.undo")[3].click();}); await sleep(100);
 await page.eval(()=>{document.querySelectorAll(".history-item.redo")[1].click();}); await sleep(100);
 const jumps=await page.eval(()=>window.__test.jumps);
 if(JSON.stringify(jumps)!=="[4,-2]")throw new Error("History jump mismatch: "+JSON.stringify(jumps));
 await page.eval(()=>{window.__test.theme.applyPalette("light");document.querySelector(".history-list").scrollTop=0;});await page.shot("history-light-long");
 await page.eval(()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
 if(await page.eval(()=>!!document.querySelector(".history")))throw new Error("Escape did not close history");
 await page.eval(async()=>{
  const {bridge,store,theme}=window.__test;bridge.setRpcOverride(null);theme.applyPalette("studio-sessions");
  document.querySelector("[data-history-toggle]").click();
  const id=store.useStore.getState().project.tracks[0].id;
  await store.act("track.set",{id,name:"Repeated 1"});
 });await sleep(150);
 const before=await page.eval(()=>document.querySelectorAll(".history-item.undo").length);
 await page.eval(async()=>{const {store}=window.__test;await store.act("track.set",{id:store.useStore.getState().project.tracks[0].id,name:"Repeated 2"});});await sleep(150);
 const after=await page.eval(()=>document.querySelectorAll(".history-item.undo").length);
 if(after!==before+1)throw new Error("Repeated action name left history stale");
 await page.eval(()=>document.querySelector(".history-item.undo").click());await sleep(150);
 if(await page.eval(()=>window.__test.store.useStore.getState().project.tracks[0].name)!=="Repeated 1")throw new Error("Undo restored wrong state");
 await page.eval(()=>document.querySelector(".history-item.redo").click());await sleep(150);
 if(await page.eval(()=>window.__test.store.useStore.getState().project.tracks[0].name)!=="Repeated 2")throw new Error("Redo restored wrong state");
 await page.shot("history-undo-redo");
 await page.eval(()=>document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true})));
 if(await page.eval(()=>!!document.querySelector(".history")))throw new Error("Outside click did not close history");
 await page.eval(()=>{window.__test.bridge.setRpcOverride(m=>m==="edit.history"?Promise.resolve({undo:[],redo:[]}):null);document.querySelector("[data-history-toggle]").click();});await sleep(150);await page.shot("history-empty");
 for(const width of [1280,768,390]){await page.viewport(width);await sleep(100);const box=await page.eval(()=>{const r=document.querySelector(".history").getBoundingClientRect();return{left:r.left,right:r.right,bottom:r.bottom};});if(box.left<11||box.right>width-11||box.bottom>860-11)throw new Error("History outside viewport: "+JSON.stringify({width,box}));}
 console.log(JSON.stringify({long,jumps,before,after}));console.log("HISTORY CHECKS PASSED");page.close();
} finally{browser.kill();}
