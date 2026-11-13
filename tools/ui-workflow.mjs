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
    mouse: (type, x, y, buttons = type === "mouseReleased" ? 0 : 1) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 }),
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
  localStorage.setItem("studio4000.referenceProfiles.v1",JSON.stringify([{id:"workflow-reference",name:"Workflow reference",spectrum:Array.from({length:160},(_,i)=>-82+i*.24),width:88,created:new Date().toISOString()}]));
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
 if(liveFades.ghost<1||liveFades.original<1)throw new Error("Copy drag has no live crossfade: "+JSON.stringify(liveFades));
 await page.eval(()=>{document.querySelector('.arrange-body').scrollLeft=270;});await sleep(100);
 const ghostControls=await page.eval(()=>{let covered=0;const leaks=[];for(const c of document.querySelectorAll('.duplicate-ghost .clip-gain,.duplicate-ghost .fade-h')){const r=c.getBoundingClientRect(),h=c.closest('.track-row').querySelector('.track-head').getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;if(x>=h.left&&x<h.right){++covered;if(!document.elementFromPoint(x,y)?.closest('.track-head'))leaks.push(c.className);}}return{covered,leaks};});
 if(!ghostControls.covered||ghostControls.leaks.length)throw new Error("Duplicate-preview controls leaked over track info: "+JSON.stringify(ghostControls));
 await page.eval(()=>{document.querySelector('.arrange-body').scrollLeft=0;});await sleep(100);await page.shot("copy-live-crossfade");
 await page.eval(d=>window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,button:0,altKey:true,clientX:d.x,clientY:d.y})),drag);await sleep(300);
 const copy=await page.eval(()=>{const clips=window.__test.store.useStore.getState().project.tracks[0].clips;return{original:clips.find(c=>c.id===window.__test.source),copy:clips.find(c=>c.id!==window.__test.source),ghosts:document.querySelectorAll(".duplicate-ghost").length};});
 if(copy.ghosts||Math.abs(copy.original.fadeOut-3)>.001||Math.abs(copy.copy.fadeIn-3)>.001)throw new Error("Drop did not retain crossfade: "+JSON.stringify(copy));await page.shot("copy-dropped-crossfade");
 const clipLayers=[];
 for(const palette of ["studio-sessions","light"]){
  await page.eval(palette=>{window.__test.theme.applyPalette(palette);window.__test.store.useStore.setState({selectedClips:[]});},palette);await sleep(100);
  for(const left of [60,270]){
   await page.eval(left=>{document.querySelector('.arrange-body').scrollLeft=left;},left);await sleep(100);
   const result=await page.eval(()=>{let covered=0,visible=0;const leaks=[];for(const row of document.querySelectorAll('.track-row[data-track]')){const h=row.querySelector('.track-head')?.getBoundingClientRect();if(!h)continue;for(const c of row.querySelectorAll('.clip-gain,.fade-h,.edge,.takes,.gain-pt')){const r=c.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;if(y<h.top||y>h.bottom||x<h.left||x>innerWidth)continue;const top=document.elementFromPoint(x,y);if(x<h.right){++covered;if(!top?.closest('.track-head'))leaks.push({control:c.className,top:top?.className,x,y});}else if(top?.closest('.clip'))++visible;}}return{covered,visible,leaks};});
   clipLayers.push({palette,left,...result});if(!result.covered||result.leaks.length)throw new Error("Clip controls leaked over track info: "+JSON.stringify(clipLayers));
  }
  await page.shot(`clip-controls-behind-header-${palette}`);
 }
 await page.eval(()=>{document.querySelector('.arrange-body').scrollLeft=0;window.__test.theme.applyPalette('studio-sessions');});await sleep(100);
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
 if(!await page.eval(()=>[...document.querySelectorAll(".modal-foot button")].find(b=>b.textContent==="Arm loop takes")?.disabled))throw new Error("Arming loop takes must require a range");
 if(await page.eval(()=>[...document.querySelectorAll(".modal-foot button")].some(b=>b.textContent==="Start recording")))throw new Error("Loop-take setup must not have an immediate recording action");await page.shot("loop-takes-needs-range");
 await page.eval(()=>document.querySelector('.modal-head button[title="Close"]').click());await page.eval(()=>window.__test.store.act("transport.setLoop",{start:1,end:4,enabled:true}));await sleep(100);
 await page.eval(()=>document.querySelector(".tbtn.rec").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true})));await sleep(100);await page.shot("loop-takes-setup");
 await page.eval(()=>{[...document.querySelectorAll('.modal label')].find(l=>l.textContent.includes('Mute previous takes')).querySelector('input').click();});await sleep(50);
 await page.eval(()=>[...document.querySelectorAll(".modal-foot button")].find(b=>b.textContent==="Arm loop takes").click());await sleep(200);
 const loop=await page.eval(()=>window.__test.store.useStore.getState().project.loopTakes);
 if(!loop.enabled||loop.takeCount!==4||loop.mutePrevious)throw new Error("Loop-take settings not saved: "+JSON.stringify(loop));
 const armed=await page.eval(()=>{const{store,vocal}=window.__test,s=store.useStore.getState();return !s.transport.playing&&!s.transport.recording&&s.project.tracks.filter(t=>t.armed).length===1&&s.project.tracks.find(t=>t.armed).id===vocal&&document.querySelector('.tbtn.rec.loop-takes .loop-take-badge')?.textContent==='LOOP';});
 if(!armed)throw new Error("Loop setup must arm the source and show LOOP without starting transport");await page.shot("loop-takes-armed");
 await page.eval(()=>document.querySelector(".tbtn.rec").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true})));await sleep(100);
 await page.eval(()=>[...document.querySelectorAll(".modal-foot button")].find(b=>b.textContent==="Turn off loop takes").click());await sleep(150);
 if(!await page.eval(()=>!window.__test.store.useStore.getState().project.loopTakes.enabled&&!window.__test.store.useStore.getState().transport.recording&&!document.querySelector('.loop-take-badge')))throw new Error("Turning loop takes off must clear the mode indicator without starting recording");
 await page.eval(()=>document.querySelector(".tbtn.rec").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true})));await sleep(100);
 await page.eval(()=>[...document.querySelectorAll(".modal-foot button")].find(b=>b.textContent==="Arm loop takes").click());await sleep(150);
 await page.eval(()=>document.querySelector('.tbtn.rec').click());await sleep(200);
 if(!await page.eval(()=>window.__test.store.useStore.getState().transport.recording))throw new Error("The armed mode must start only when Record is clicked");
 await page.eval(()=>document.querySelector('.tbtn.rec').click());await sleep(150);
 if(!await page.eval(()=>!window.__test.store.useStore.getState().transport.recording&&window.__test.store.useStore.getState().project.loopTakes.enabled))throw new Error("Stopping recording must retain the prepared loop mode");
 await page.eval(()=>{const{store,theme,vocal}=window.__test;store.useStore.setState({browserTab:"fx",bottom:null});theme.applyPalette("light");const p=store.useStore.getState().project.tracks.find(t=>t.id===vocal).plugins.find(p=>p.type==="s4000eq");store.openPlugin(p.id);});await sleep(450);
 const eqDrag=await page.eval(()=>{const c=document.querySelector('.fx-eq .fx-canvas'),r=c.getBoundingClientRect(),tab=document.querySelector('.fx-band-tab.on');const f=parseFloat(tab.querySelector('.freq').textContent)*(/kHz/.test(tab.querySelector('.freq').textContent)?1000:1),g=parseFloat(tab.querySelector('.gain')?.textContent||'0');return{x:r.left+Math.log(f/20)/Math.log(1000)*r.width,y:r.top+r.height/2-(g/18)*(r.height/2),before:tab.querySelector('.freq').textContent};});
 await page.eval(()=>window.__s4MockParamWrites=0);await page.mouse("mousePressed",eqDrag.x,eqDrag.y);const eqLive=[];
 for(const dx of [18,36,54,72,90]){await page.mouse("mouseMoved",eqDrag.x+dx,eqDrag.y-25);await sleep(30);eqLive.push(await page.eval(()=>{const label=document.querySelector('.fx-band-tab.on .freq').textContent,line=document.querySelector('.fx-eq-detail .fx-knob-pointer'),x=Number(line?.getAttribute('x2')),y=Number(line?.getAttribute('y2')),c=27;return{frequency:parseFloat(label)*(/kHz/.test(label)?1000:1),angle:Math.atan2(x-c,c-y)};}));}
 const freqMonotonic=eqLive.every((p,i)=>!i||p.frequency>=eqLive[i-1].frequency)&&eqLive.at(-1).frequency>eqLive[0].frequency;
 const angles=eqLive.map(p=>p.angle);for(let i=1;i<angles.length;i++)while(angles[i]<angles[i-1]-Math.PI)angles[i]+=Math.PI*2;
 const knobMonotonic=angles.every((a,i)=>!i||a>=angles[i-1]-.015)&&angles.at(-1)>angles[0];
 const liveEngineWrites=await page.eval(()=>window.__s4MockParamWrites||0);if(!freqMonotonic||!knobMonotonic)throw new Error("Selected EQ frequency knob jumped during the live node drag: "+JSON.stringify({eqLive,angles}));if(liveEngineWrites<1)throw new Error("EQ drag did not reach the audio engine until pointer release");await page.mouse("mouseReleased",eqDrag.x+90,eqDrag.y-25,0);await page.shot("light-eq-readable");
 const colours=await page.eval(async()=>{
  const root=getComputedStyle(document.documentElement);
  const active=document.querySelector(".fx-eq-detail .fx-seg button.on"),style=getComputedStyle(active);
  const heading=getComputedStyle(document.querySelector('.browser[data-browser-tab="fx"] .section-title')).color;
  const headings=[...document.querySelectorAll('.browser .b-group.section-title')].map(el=>({color:getComputedStyle(el).color,weight:getComputedStyle(el).fontWeight,size:getComputedStyle(el).fontSize,background:getComputedStyle(el).backgroundColor,border:parseFloat(getComputedStyle(el).borderLeftWidth),children:[...el.children].map(c=>getComputedStyle(c).color)}));
  const {contrast}=await import('/src/palettes.ts');
  const hex=rgb=>'#'+rgb.map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');
  const headingContrast=Math.min(...headings.flatMap(h=>{const fill=h.background.match(/[\d.]+/g).map(Number),alpha=fill[3]??1,ink=hex(h.color.match(/[\d.]+/g).slice(0,3).map(Number));return [[116,124,134],[92,100,110]].map(bg=>contrast(ink,hex(fill.slice(0,3).map((v,i)=>v*alpha+bg[i]*(1-alpha)))));}));
  const itemColor=getComputedStyle(document.querySelector('.browser .b-item')).color;
  return{backgrounds:["--bg","--bg1","--bg2","--bg3","--bg4"].map(bg=>root.getPropertyValue(bg).trim()),text:root.getPropertyValue("--text").trim(),eqText:style.color,eqGlyph:getComputedStyle(active.querySelector(".glyph")).color,heading,headings,headingContrast,itemColor,weight:getComputedStyle(document.body).fontWeight};
 });if(colours.backgrounds.join(",")!=="#5c646e,#707880,#868e97,#9aa2aa,#656d77"||colours.text!=="#080b10"||colours.weight!=="500"||colours.eqText!=="rgb(255, 255, 255)"||colours.eqGlyph!==colours.eqText||colours.headingContrast<4.5||colours.heading===colours.itemColor||colours.headings.some(h=>h.color!=="rgb(84, 34, 154)"||h.weight!=="700"||h.size!=="12px"||h.border<2||h.children.some(c=>c!==h.color)))throw new Error("Original Light appearance or category readability failure: "+JSON.stringify(colours));
 const browserAccents=[];
 for(const tab of ['inst','media','chains']){
  await page.eval(tab=>window.__test.store.useStore.setState({browserTab:tab,openPlugins:[]}),tab);await sleep(100);
  const groups=await page.eval(()=>[...document.querySelectorAll('.browser .b-group.section-title')].map(el=>getComputedStyle(el).color));
  browserAccents.push({tab,count:groups.length});if(tab!=='media'&&!groups.length||groups.some(c=>c!=='rgb(84, 34, 154)'))throw new Error('Browser section accent missing: '+JSON.stringify({tab,groups}));
 }
 await page.eval(()=>window.__test.store.useStore.setState({browserTab:'fx'}));await page.shot('light-browser-accent');
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
 const groupPrint=await page.eval(async()=>{const{store,vocal}=window.__test;const [bus]=await store.act("track.add",{kind:"group",name:"Vocal print bus"});await store.act("track.set",{id:vocal,output:bus});const result=await store.act("track.bounce",{id:bus});await new Promise(r=>setTimeout(r,80));store.useStore.setState({view:"tracks",selectedTrack:result.trackId});const p=store.useStore.getState().project,source=p.tracks.find(t=>t.id===bus),printed=p.tracks.find(t=>t.id===result.trackId);return{sourceMuted:source?.mute,bouncedFrom:printed?.bouncedFrom,bouncedGroup:printed?.bouncedGroup,name:printed?.name,printId:result.trackId};});
 if(!groupPrint.sourceMuted||!groupPrint.bouncedGroup||groupPrint.bouncedFrom==null||!/group FX print/.test(groupPrint.name||""))throw new Error("Group FX print was not labelled or did not mute its source: "+JSON.stringify(groupPrint));await sleep(100);if(!await page.eval(id=>!!document.querySelector(`.track-row[data-track="${id}"] .kind.baked`),groupPrint.printId))throw new Error("Baked group output has no visible FX PRINT indicator");await page.shot("group-fx-print");
 await page.eval(()=>window.__test.store.useStore.setState({view:"tracks",aboutOpen:false,referenceOpen:true}));await sleep(120);
 const referenceUi=await page.eval(()=>({title:document.querySelector('.reference-window .fx-window-head b')?.textContent,canPick:[...document.querySelectorAll('.reference-tool button')].some(b=>b.textContent.includes('Choose app / window')),graphs:document.querySelectorAll('.reference-graphs canvas').length,profile:!!document.querySelector('.reference-actions select'),blocking:!!document.querySelector('.modal-bg')}));
 if(referenceUi.title?.trim()!=="Reference Analyzer"||!referenceUi.canPick||referenceUi.graphs!==2||!referenceUi.profile||referenceUi.blocking)throw new Error("Reference FX window is incomplete or blocks the DAW: "+JSON.stringify(referenceUi));await page.shot("reference-track");
 const referenceApplied=await page.eval(async()=>{const{store,vocal}=window.__test;const choose=(el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));};choose(document.querySelector('.reference-actions .reference-profile-select'),'workflow-reference');choose(document.querySelector('.reference-actions .reference-target-select'),vocal);await new Promise(r=>setTimeout(r,40));document.querySelector('.reference-actions .btn.accent').click();await new Promise(r=>setTimeout(r,180));const track=store.useStore.getState().project.tracks.find(t=>t.id===vocal),eqs=track.plugins.filter(p=>p.type==='s4000eq'),last=eqs[eqs.length-1];return{count:eqs.length,gains:last?.params.filter(p=>/^b\d+gain$/.test(p.id)).map(p=>p.value)??[]};});
 if(referenceApplied.count<2||!referenceApplied.gains.some(g=>Math.abs(g)>.1))throw new Error("Saved Reference profile did not create a shaped match EQ: "+JSON.stringify(referenceApplied));
 await page.eval(()=>{window.__test.store.useStore.setState({openPlugins:[],referenceOpen:false});});await sleep(80);const backgroundReference=await page.eval(()=>({bar:!!document.querySelector('.reference-background-pill'),apply:[...document.querySelectorAll('.reference-background-pill button')].some(b=>b.textContent.includes('Apply EQ')),target:!!document.querySelector('.reference-background-pill .reference-target-select')}));if(!backgroundReference.bar||!backgroundReference.apply||!backgroundReference.target)throw new Error("Reference Match is not usable while hidden: "+JSON.stringify(backgroundReference));
 await page.eval(()=>document.querySelector('.reference-background-pill .reference-dismiss').click());await sleep(50);if(await page.eval(()=>!!document.querySelector('.reference-background-pill')))throw new Error("Dismissed Reference Match controller stayed visible");
 await page.eval(()=>{window.__test.store.useStore.setState({view:"tracks",openPlugins:[],referenceOpen:false,aboutOpen:true});});await page.shot("whats-new-light");
 await page.eval(()=>window.__test.theme.applyPalette("studio-sessions"));await page.shot("whats-new-dark");
 const darkBadge=await page.eval(()=>getComputedStyle(document.querySelector(".track-head .toggle.fx.on")).backgroundColor);if(darkBadge!=="rgb(255, 0, 255)")throw new Error("Default dark track FX is not fuchsia");
 await page.viewport(390);await sleep(100);await page.shot("whats-new-mobile");
 console.log(JSON.stringify({ranges,split,liveFades,copy:{fadeIn:copy.copy.fadeIn,fadeOut:copy.original.fadeOut},applied,appended,loop,colours,darkBadge},null,2));console.log("WORKFLOW CHECKS PASSED");page.close();
} finally{browser.kill();}
