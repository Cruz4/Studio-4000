// Exercises editing, recording setup, chains, theme readability and Mono controls in the browser preview.
// Start the UI dev server first, then: node tools/ui-workflow.mjs [--ui http://localhost:5174] [--out ui-smoke]

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const UI = arg("ui", "http://127.0.0.1:5174/");
const RELAY = arg("relay", "ws://127.0.0.1:3031");
const OUT = resolve(arg("out", "ui-smoke"));
const PORT = 9352;
const W = 1440, H = 860;

const edge = [
  `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((p) => existsSync(p));
if (!edge) throw new Error("Microsoft Edge not found");
mkdirSync(OUT, { recursive: true });

const browser = spawn(edge, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmpdir(), "s4-workflow-ui")}`,
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
 const page=await openPage();await page.go(UI);
 await page.eval(async()=>{
  const urls=performance.getEntriesByType("resource").map(e=>e.name);
  const store=await import(urls.find(u=>new URL(u).pathname==="/src/store.ts"));
  const theme=await import("/src/theme.ts");const {TRACK_CHAINS}=await import("/src/trackChains.ts");
  window.__test={store,theme,chains:TRACK_CHAINS};
  await store.act("project.new",{name:"Workflow checks",template:"vocal"});await new Promise(r=>setTimeout(r,150));
  store.useStore.setState({aboutOpen:false,bottom:null,side:null,browserOpen:true,grid:"off"});theme.applyPalette("studio-sessions");
  const tracks=store.useStore.getState().project.tracks;
  for(const t of tracks.slice(0,3)){for(const extra of t.clips.slice(1)) await store.act("clip.delete",{id:extra.id});await store.act("clip.move",{id:t.clips[0].id,start:0});await store.act("clip.trim",{id:t.clips[0].id,end:6});}
  window.__test.source=tracks[0].clips[0].id;window.__test.vocal=tracks[1].id;
 });await sleep(250);
 const ranges=[];
 for(const tool of ["move","time","split"]){
  await page.eval(async(tool)=>{
   const{store}=window.__test;store.useStore.setState({tool});await store.act("transport.setLoop",{start:0,end:0,enabled:false});
   const ruler=document.querySelector(".ruler-canvas");const b=ruler.getBoundingClientRect(),pps=store.useStore.getState().pxPerSec;
   const x=b.left+pps,y=b.top+25;window.__test.pointer={x:x+3*pps,y};
   ruler.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,buttons:1,clientX:x,clientY:y}));
   window.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,buttons:1,clientX:x+3*pps,clientY:y}));
  },tool);await sleep(100);
  const preview=await page.eval(()=>{const el=document.querySelector(".time-range");return el?{width:el.getBoundingClientRect().width,bg:getComputedStyle(el).backgroundColor}:null;});
  if(!preview||preview.width<100)throw new Error("No live ruler time highlight for "+tool);
  await page.eval(()=>{const p=window.__test.pointer;window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,button:0,clientX:p.x,clientY:p.y}));});await sleep(120);
  const result=await page.eval(()=>({range:window.__test.store.useStore.getState().project.loop,tool:window.__test.store.useStore.getState().tool}));
  if(Math.abs(result.range[0]-1)>.001||Math.abs(result.range[1]-4)>.001||result.tool!==tool)throw new Error(JSON.stringify(result));ranges.push(result);
 }
 await page.shot("ruler-selection");
 await page.eval(()=>{
  const el=document.querySelector('[data-clip="'+window.__test.source+'"]');const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:r.left+100,clientY:r.top+45}));
 });await sleep(100);
 await page.eval(()=>{const item=[...document.querySelectorAll(".menu-row")].find(e=>e.textContent.includes("Split all tracks at selection boundaries"));if(!item)throw new Error("Missing selected-range split command");item.click();});await sleep(150);
 const split=await page.eval(()=>window.__test.store.useStore.getState().project.tracks.slice(0,3).map(t=>t.clips.length));
 if(split.some(n=>n!==3))throw new Error("Range did not split all tracks: "+split);
 await page.eval(()=>window.__test.store.act("edit.undo"));await sleep(120);
 const drag=await page.eval(()=>{
  const{store,source}=window.__test;store.useStore.setState({tool:"move",selectedClips:[source]});
  const el=document.querySelector('[data-clip="'+source+'"] .clip-label'),r=el.getBoundingClientRect();const x=r.left+55,y=r.top+8;const pps=store.useStore.getState().pxPerSec;
  el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,buttons:1,altKey:true,clientX:x,clientY:y}));
  window.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,buttons:1,altKey:true,clientX:x+3*pps,clientY:y}));return{x:x+3*pps,y};
 });await sleep(150);
 const liveFades=await page.eval(()=>({ghost:document.querySelectorAll(".duplicate-ghost .fade-edge").length,original:[...document.querySelectorAll('[data-clip="'+window.__test.source+'"]')].find(e=>!e.closest(".duplicate-ghost")).querySelectorAll(".fade-edge").length}));
 if(liveFades.ghost<1||liveFades.original<1)throw new Error("Copy drag has no live crossfade: "+JSON.stringify(liveFades));await page.shot("copy-live-crossfade");
 await page.eval(d=>window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,button:0,altKey:true,clientX:d.x,clientY:d.y})),drag);await sleep(300);
 const copy=await page.eval(()=>{const clips=window.__test.store.useStore.getState().project.tracks[0].clips;return{original:clips.find(c=>c.id===window.__test.source),copy:clips.find(c=>c.id!==window.__test.source),ghosts:document.querySelectorAll(".duplicate-ghost").length};});
 if(copy.ghosts||Math.abs(copy.original.fadeOut-3)>.001||Math.abs(copy.copy.fadeIn-3)>.001)throw new Error("Drop did not retain crossfade: "+JSON.stringify(copy));await page.shot("copy-dropped-crossfade");
 await page.eval(()=>{const{store,vocal}=window.__test;store.useStore.setState({selectedTrack:vocal,selectedTracks:[vocal],selectedClips:[],browserTab:"chains"});});await sleep(200);await page.shot("factory-chains-browser");
 await page.eval(()=>document.querySelector(".chain-item").click());await sleep(120);await page.shot("factory-chain-preview");
 await page.eval(()=>[...document.querySelectorAll(".modal-foot button")].find(b=>b.textContent.startsWith("Apply to")).click());await sleep(200);
 const applied=await page.eval(()=>{const t=window.__test.store.useStore.getState().project.tracks.find(t=>t.id===window.__test.vocal);return t.plugins.map(p=>p.type);});
 if(JSON.stringify(applied)!==JSON.stringify(await page.eval(()=>window.__test.chains[0].plugins.map(p=>p.type))))throw new Error("Factory chain apply order mismatch");
 await page.eval(()=>{const{store,vocal,chains}=window.__test;store.useStore.setState({chainPreset:{id:chains[1].id,trackId:vocal}});});await sleep(100);
 await page.eval(()=>{const s=document.querySelector(".modal select");s.value="append";s.dispatchEvent(new Event("change",{bubbles:true}));});await sleep(50);
 await page.eval(()=>[...document.querySelectorAll(".modal-foot button")].find(b=>b.textContent.startsWith("Apply to")).click());await sleep(150);
 const appended=await page.eval(()=>window.__test.store.useStore.getState().project.tracks.find(t=>t.id===window.__test.vocal).plugins.length);
 if(appended<=applied.length)throw new Error("Append replaced the chain");await page.eval(()=>window.__test.store.act("edit.undo"));await sleep(120);
 if(await page.eval(()=>window.__test.store.useStore.getState().project.tracks.find(t=>t.id===window.__test.vocal).plugins.length)!==applied.length)throw new Error("Factory chain did not undo as one step");
 await page.eval(()=>{const{store}=window.__test;store.useStore.setState({browserTab:"fx",bottom:null,openPlugins:[]});return store.act("transport.setLoop",{start:0,end:0,enabled:false});});await sleep(120);
 await page.eval(()=>document.querySelector(".tbtn.rec").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true})));await sleep(100);
 if(!await page.eval(()=>[...document.querySelectorAll(".modal-foot button")].find(b=>b.textContent==="Start recording")?.disabled))throw new Error("Loop takes must require a range");await page.shot("loop-takes-needs-range");
 await page.eval(()=>document.querySelector('.modal-head button[title="Close"]').click());await page.eval(()=>window.__test.store.act("transport.setLoop",{start:1,end:4,enabled:true}));await sleep(100);
 await page.eval(()=>document.querySelector(".tbtn.rec").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true})));await sleep(100);await page.shot("loop-takes-setup");
 await page.eval(()=>{const boxes=document.querySelectorAll('.modal input[type="checkbox"]');boxes[2].click();});await sleep(50);
 await page.eval(()=>[...document.querySelectorAll(".modal-foot button")].find(b=>b.textContent==="Save settings").click());await sleep(150);
 const loop=await page.eval(()=>window.__test.store.useStore.getState().project.loopTakes);
 if(!loop.enabled||loop.takeCount!==4||loop.mutePrevious)throw new Error("Loop-take settings not saved: "+JSON.stringify(loop));
 await page.eval(()=>{const{store,theme,vocal}=window.__test;store.useStore.setState({browserTab:"fx",bottom:null});theme.applyPalette("light");const p=store.useStore.getState().project.tracks.find(t=>t.id===vocal).plugins.find(p=>p.type==="s4000eq");store.openPlugin(p.id);});await sleep(450);await page.shot("light-eq-readable");
 const colours=await page.eval(async()=>{
  const{contrast}=await import("/src/palettes.ts");const root=getComputedStyle(document.documentElement);const rgbHex=s=>"#"+(s.match(/[\d.]+/g)||[]).slice(0,3).map(n=>Math.round(+n).toString(16).padStart(2,"0")).join("");
  const active=document.querySelector(".fx-eq-detail .fx-seg button.on"),style=getComputedStyle(active);
  const heading=getComputedStyle(document.querySelector('.browser[data-browser-tab="fx"] .section-title')).color;
  const badge=getComputedStyle(document.querySelector(".track-head .toggle.fx.on")).backgroundColor;
  const text=[];for(const bg of["--bg","--bg1","--bg2","--bg3","--bg4"])for(const ink of["--text","--dim","--faint"])text.push(contrast(root.getPropertyValue(bg).trim(),root.getPropertyValue(ink).trim()));
  return{eqContrast:contrast(rgbHex(style.color),rgbHex(style.backgroundColor)),minTextContrast:Math.min(...text),heading,badge,weight:getComputedStyle(document.body).fontWeight};
 });if(colours.eqContrast<4.5||colours.minTextContrast<4.5||colours.heading!==colours.badge)throw new Error("Light-theme readability failure: "+JSON.stringify(colours));
 await page.eval(async()=>{const{store}=window.__test;store.useStore.setState({openPlugins:[]});await store.act("track.add",{kind:"group",name:"Mono check bus"});window.__test.formats=Object.fromEntries(store.useStore.getState().project.tracks.map(t=>[t.id,t.channels]));});await sleep(120);
 const monoControls=await page.eval(()=>document.querySelectorAll(".track-head .sum-mono").length);
 const trackCount=await page.eval(()=>window.__test.store.useStore.getState().project.tracks.length);
 if(monoControls!==trackCount+1)throw new Error("Mono controls missing on track headers or master");
 await page.eval(()=>document.querySelectorAll(".track-head .sum-mono").forEach(b=>b.click()));await sleep(150);
 const monoOn=await page.eval(()=>{const p=window.__test.store.useStore.getState().project;return p.master.sumToMono&&p.tracks.every(t=>t.sumToMono&&t.channels===window.__test.formats[t.id]);});
 if(!monoOn)throw new Error("Mono controls changed a recording format or failed to toggle");await page.shot("mono-checks-tracks");
 await page.eval(()=>window.__test.store.useStore.setState({view:"mixer"}));await sleep(120);
 if(await page.eval(()=>document.querySelectorAll(".strip .sum-mono").length)!==trackCount+1)throw new Error("Mono controls missing from mixer");
 const monoClipped=await page.eval(()=>Array.from(document.querySelectorAll(".strip .sum-mono")).some(b=>{const r=b.getBoundingClientRect(),s=b.closest(".strip").getBoundingClientRect();return r.left<s.left+2||r.right>s.right-2;}));
 if(monoClipped)throw new Error("A mixer Mono button is clipped by its strip");await page.shot("mono-checks-mixer");
 await page.eval(()=>document.querySelectorAll(".strip .sum-mono").forEach(b=>b.click()));await sleep(150);
 const monoOff=await page.eval(()=>{const p=window.__test.store.useStore.getState().project;return !p.master.sumToMono&&p.tracks.every(t=>!t.sumToMono);});if(!monoOff)throw new Error("Mono controls did not restore stereo");
 await page.eval(()=>{window.__test.store.useStore.setState({view:"tracks",openPlugins:[],aboutOpen:true});});await page.shot("whats-new-light");
 await page.eval(()=>window.__test.theme.applyPalette("studio-sessions"));await page.shot("whats-new-dark");
 const darkBadge=await page.eval(()=>getComputedStyle(document.querySelector(".track-head .toggle.fx.on")).backgroundColor);if(darkBadge!=="rgb(255, 0, 255)")throw new Error("Default dark track FX is not fuchsia");
 await page.viewport(390);await sleep(100);await page.shot("whats-new-mobile");
 console.log(JSON.stringify({ranges,split,liveFades,copy:{fadeIn:copy.copy.fadeIn,fadeOut:copy.original.fadeOut},applied,appended,loop,colours,darkBadge},null,2));console.log("WORKFLOW CHECKS PASSED");page.close();
} finally{browser.kill();}
