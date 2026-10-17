import {
  nudgeSelection, runCommand, toggleBottom, toggleTrackFx, zoom,
} from "../commands";
import { baseNote, noteOff, noteOn, shiftOctave, shiftVelocity } from "../keys";
import { act, closePlugin, live, openPlugin, selectPlugin, selectTrack, useStore } from "../store";
import type { ArrangeTool } from "../store";
import { clamp, gridSeconds, secondsPerBar, secondsPerBeat } from "../util";
import { closeDialog, crawlActivate, crawlMove, crawlSync, cycleTabs, mark, padRoot } from "./crawl";
import { setGamepadFocus, usePad } from "./pad";
import type { Bindings, DpadDir, Layer, Region } from "./types";

const TOOLS: ArrangeTool[] = ["move", "time", "split", "slip", "erase"];
const BROWSER_TABS = ["fx", "inst", "media", "chains"] as const;
const SCALE = [0, 2, 4, 5, 7, 9, 11, 12];

export const PLACES: { id: Region; label: string; run: () => void }[] = [
  { id: "arrange", label: "Tracks", run: () => { useStore.setState({ view: "tracks" }); setGamepadFocus("arrange"); } },
  { id: "mixer", label: "Mixer", run: () => { useStore.setState({ view: "mixer" }); setGamepadFocus("mixer"); } },
  { id: "editor", label: "Editor", run: () => { useStore.setState({ view: "tracks", bottom: "editor" }); setGamepadFocus("editor"); } },
  { id: "effects", label: "Effects", run: () => { useStore.setState({ view: "tracks", bottom: "effects" }); setGamepadFocus("effects"); } },
  { id: "browser", label: "Browser", run: () => { useStore.setState({ browserOpen: true }); setGamepadFocus("browser"); } },
  { id: "smart", label: "Smart Mix", run: () => { useStore.setState({ view: "tracks", bottom: "smart" }); setGamepadFocus("smart"); } },
  { id: "assistant", label: "Assistant", run: () => { useStore.setState({ side: "assistant" }); setGamepadFocus("assistant"); } },
  { id: "keyboard", label: "Keyboard", run: () => { useStore.setState({ keysOpen: true, typing: true }); setGamepadFocus("keyboard"); } },
];

const buckets = new Map<string, { v: number; t: number }>();
function coalesce(key: string, value: number, ms: number, min: number, send: (v: number) => void) {
  const bucket = buckets.get(key) ?? { v: 0, t: 0 };
  bucket.v += value;
  const now = performance.now();
  if (now - bucket.t >= ms && Math.abs(bucket.v) >= min) {
    const total = bucket.v;
    bucket.v = 0;
    bucket.t = now;
    send(total);
  }
  buckets.set(key, bucket);
}

function project() { return useStore.getState().project; }

function selectedTrack() {
  const s = useStore.getState();
  return s.project?.tracks.find((t) => t.id === s.selectedTrack) ?? s.project?.tracks[0];
}

function canPerform() {
  const s = useStore.getState();
  if (s.typing) return true;
  return selectedTrack()?.kind === "instrument";
}

function moveTrack(dir: number) {
  const tracks = project()?.tracks ?? [];
  if (!tracks.length) return;
  const index = Math.max(0, tracks.findIndex((t) => t.id === useStore.getState().selectedTrack));
  const next = tracks[Math.max(0, Math.min(tracks.length - 1, index + dir))];
  if (next) selectTrack(next.id);
}

function nudgePlayhead(dir: number, fine: boolean) {
  const song = project();
  if (!song) return;
  const step = fine ? (gridSeconds(useStore.getState().grid, song) || secondsPerBeat(song)) : secondsPerBar(song);
  act("transport.setPosition", { time: Math.max(0, live.tick.t + dir * step) });
}

export function sharedDpad(dir: DpadDir, layer: Layer) {
  if ((dir === "up" || dir === "down") && layer !== "rt") moveTrack(dir === "up" ? -1 : 1);
  else if (dir === "left" || dir === "right") {
    if (layer === "rt" && canPerform()) shiftOctave(dir === "left" ? -1 : 1);
    else nudgePlayhead(dir === "left" ? -1 : 1, layer === "lt");
  }
}

function scrollBy(selector: string, dx: number, dy: number) {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  el.scrollLeft += dx;
  el.scrollTop += dy;
}

let stopAt = 0;
function stopAgain() {
  const now = performance.now();
  const moving = useStore.getState().transport.playing || useStore.getState().transport.recording;
  if (!moving && now - stopAt < 700) act("transport.setPosition", { time: 0 });
  else act("transport.stop");
  stopAt = now;
}

let perfNote: number | null = null;
let perfHeld = false;
function playPerf(note: number | null, velocity = 100) {
  if (note === perfNote) return;
  if (perfNote !== null) noteOff(perfNote);
  perfNote = note;
  if (note !== null) noteOn(note, velocity);
}

function cycleTool(dir: number) {
  const tool = useStore.getState().tool;
  const index = Math.max(0, TOOLS.indexOf(tool));
  useStore.setState({ tool: TOOLS[(index + dir + TOOLS.length) % TOOLS.length] });
}

const arrange: Bindings = {
  title: "Tracks",
  get bare() {
    const playing = useStore.getState().transport.playing && !useStore.getState().transport.recording;
    return {
      a: { label: playing ? "Stop" : "Play", run: () => runCommand("play") },
      b: { label: "Stop", run: stopAgain },
      x: { label: "Split", run: () => runCommand("split") },
      y: { label: "Arm", run: () => runCommand("arm") },
    };
  },
  lt: {
    a: { label: "Duplicate", run: () => runCommand("duplicate") },
    b: { label: "Delete", run: () => runCommand("delete") },
    x: { label: "Cut", run: () => runCommand("cut") },
    y: { label: "Copy", run: () => runCommand("copy") },
  },
  get rt() {
    return canPerform()
      ? {
        a: { label: "Hold note", run: () => { perfHeld = true; }, release: () => { perfHeld = false; playPerf(null); } },
        b: { label: "Punch", run: () => runCommand("punch") },
        x: { label: "Count-in", run: () => runCommand("countIn") },
        y: { label: "Loop clips", run: () => runCommand("loopSel") },
      }
      : {
        a: { label: "Record", run: () => runCommand("record") },
        b: { label: "Punch", run: () => runCommand("punch") },
        x: { label: "Count-in", run: () => runCommand("countIn") },
        y: { label: "Loop clips", run: () => runCommand("loopSel") },
      };
  },
  lbTap: { label: "Next tool", run: () => cycleTool(1) },
  wheel: TOOLS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), run: () => useStore.setState({ tool: id }) })),
  onDpad: (dir, layer) => {
    if (layer === "lt" && useStore.getState().selectedClips.length) {
      const key = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown" }[dir];
      nudgeSelection(key, false);
      return true;
    }
    sharedDpad(dir, layer);
    return true;
  },
  onClick: (button, layer) => {
    if (button === "r3" && layer === "rt" && canPerform()) { runCommand("record"); return true; }
    return false;
  },
  onGlobal: (id, layer) => {
    if (id === "palette" && layer === "lt") { runCommand("paste"); return true; }
    return false;
  },
  onFrame: ({ axes, dt, layer, triggers }) => {
    const fine = layer === "lt" ? 0.3 : 1;
    if (axes.lx) coalesce("scrub", axes.lx * dt * 8 * fine, 40, 0.01, (step) => act("transport.setPosition", { time: Math.max(0, live.tick.t + step) }));
    if (axes.ly) scrollBy(".arrange-body", 0, axes.ly * dt * 640);
    if (axes.rx) zoom(Math.exp(axes.rx * dt * 1.1));
    if (axes.ry) scrollBy(".arrange-body", axes.ry * dt * 280, 0);
    if (perfHeld && canPerform() && layer === "rt") {
      const note = clamp(baseNote() + Math.round(axes.rx * 12), 0, 127);
      playPerf(note, clamp(Math.round((triggers.rt || 0.8) * 127), 1, 127));
    } else if (perfNote !== null && !perfHeld) playPerf(null);
  },
};

let mixCursor: string | null = null;
function mixerIds() {
  const song = project();
  return song ? [...song.tracks.map((t) => t.id), "master"] : [];
}
function currentStrip() {
  const ids = mixerIds();
  const selected = useStore.getState().selectedTrack;
  if (mixCursor === "master" && ids.includes("master")) return "master";
  if (selected && ids.includes(selected)) mixCursor = selected;
  else if (!mixCursor || !ids.includes(mixCursor)) mixCursor = ids[0] ?? "master";
  return mixCursor ?? "master";
}
function mixerTrack() {
  const id = currentStrip();
  if (!id || id === "master") return;
  return project()?.tracks.find((t) => t.id === id);
}
function stepStrip(dir: number) {
  const ids = mixerIds();
  if (!ids.length) return;
  const index = Math.max(0, ids.indexOf(currentStrip()));
  mixCursor = ids[Math.max(0, Math.min(ids.length - 1, index + dir))] ?? mixCursor;
  if (mixCursor && mixCursor !== "master") selectTrack(mixCursor);
  mark(".strip", "data-track", mixCursor);
}
function stripVolume(id: string, delta: number) {
  const song = project();
  if (!song || !delta) return;
  if (id === "master") act("master.set", { volumeDb: clamp((song.master.volumeDb ?? 0) + delta, -100, 15) });
  else {
    const track = song.tracks.find((t) => t.id === id);
    if (track) act("track.set", { id, volumeDb: clamp((track.volumeDb ?? 0) + delta, -100, 15) });
  }
}
function stripPan(id: string, delta: number) {
  const song = project();
  if (!song || !delta || id === "master") return;
  const track = song.tracks.find((t) => t.id === id);
  if (!track) return;
  act("track.set", { id, pan: clamp(Math.round(((track.pan ?? 0) + delta) * 100) / 100, -1, 1) });
}
function stripSend(id: string, delta: number) {
  const track = project()?.tracks.find((t) => t.id === id);
  const send = track?.sends[0];
  if (!send || !delta) return;
  act("send.set", { id: send.id, gainDb: clamp(send.gainDb + delta, -60, 6) });
}

let markedStrip = "";
const mixer: Bindings = {
  title: "Mixer",
  bare: {
    a: { label: "Solo", run: () => { const t = mixerTrack(); if (t) act("track.set", { id: t.id, solo: !t.solo }); } },
    b: { label: "Mute", run: () => { const t = mixerTrack(); if (t) act("track.set", { id: t.id, mute: !t.mute }); } },
    x: { label: "Arm", run: () => { const t = mixerTrack(); if (t && (t.kind === "audio" || t.kind === "instrument")) act("track.arm", { id: t.id, armed: !t.armed }); } },
    y: { label: "Effects", run: () => { if (currentStrip() === "master") toggleTrackFx("master"); else { useStore.setState({ bottom: "effects" }); setGamepadFocus("effects"); } } },
  },
  lt: {
    a: { label: "Fine fader", run: () => {} },
    b: { label: "Fine fader", run: () => {} },
    x: { label: "Effects off", run: () => { const id = currentStrip(); if (id) toggleTrackFx(id); } },
    y: { label: "Reset fader", run: () => { const id = currentStrip(); if (id === "master") act("master.set", { volumeDb: 0 }); else if (id) act("track.set", { id, volumeDb: 0 }); } },
  },
  rt: {
    a: { label: "Pan", run: () => {} },
    b: { label: "Send", run: () => {} },
    x: { label: "Arm", run: () => runCommand("arm") },
    y: { label: "Loop", run: () => runCommand("loop") },
  },
  wheel: [
    { id: "reset", label: "Reset fader", run: () => { const id = currentStrip(); if (id === "master") act("master.set", { volumeDb: 0 }); else if (id) act("track.set", { id, volumeDb: 0 }); } },
    { id: "fx", label: "Effects on/off", run: () => { const id = currentStrip(); if (id) toggleTrackFx(id); } },
    { id: "solo", label: "Solo", run: () => { const t = mixerTrack(); if (t) act("track.set", { id: t.id, solo: !t.solo }); } },
    { id: "mute", label: "Mute", run: () => { const t = mixerTrack(); if (t) act("track.set", { id: t.id, mute: !t.mute }); } },
    { id: "arm", label: "Arm", run: () => runCommand("arm") },
    { id: "open", label: "Open effects", run: () => { useStore.setState({ view: "tracks", bottom: "effects" }); setGamepadFocus("effects"); } },
  ],
  onDpad: (dir) => {
    if (dir === "left" || dir === "up") stepStrip(-1);
    else stepStrip(1);
    return true;
  },
  onClick: (button) => {
    if (button === "l3") {
      const id = currentStrip();
      if (id === "master") act("master.set", { volumeDb: 0 });
      else if (id) act("track.set", { id, volumeDb: 0 });
      return true;
    }
    return false;
  },
  onFrame: ({ axes, dt, layer }) => {
    const id = currentStrip();
    mark(".strip", "data-track", id);
    if (id !== markedStrip) {
      markedStrip = id;
      document.querySelector<HTMLElement>(id === "master" ? ".strip.master" : `.strip[data-track="${CSS.escape(id)}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
    const fine = layer === "lt" ? 2 : 10;
    if (layer === "rt") {
      if (axes.lx) coalesce("pan", axes.lx * dt, 50, 0.01, (v) => stripPan(id, v));
      if (axes.ry) coalesce("send", -axes.ry * dt * 8, 50, 0.05, (v) => stripSend(id, v));
    } else if (axes.ly) coalesce("fader", -axes.ly * dt * fine, 50, 0.05, (v) => stripVolume(id, v));
    if (axes.rx && layer !== "rt") scrollBy(".mixer", axes.rx * dt * 700, 0);
  },
};

function effectList() {
  const track = selectedTrack();
  return { track, plugs: (track?.plugins ?? []).filter((p) => !p.synth) };
}
let fxCursor = 0;
function stepFx(dir: number) {
  const { plugs } = effectList();
  if (!plugs.length) return;
  const selected = useStore.getState().selectedPlugin;
  const from = plugs.findIndex((p) => p.id === selected);
  fxCursor = from >= 0 ? from : fxCursor;
  fxCursor = (fxCursor + dir + plugs.length) % plugs.length;
  selectPlugin(plugs[fxCursor].id);
  mark(".fx-col", "data-plugin", plugs[fxCursor].id);
}
function currentFx() {
  const { plugs } = effectList();
  if (!plugs.length) return;
  const selected = plugs.find((p) => p.id === useStore.getState().selectedPlugin) ?? plugs[Math.min(fxCursor, plugs.length - 1)];
  return selected;
}

const effects: Bindings = {
  title: "Effects",
  bare: {
    a: { label: "Open", run: () => { const fx = currentFx(); if (fx) { openPlugin(fx.id); setGamepadFocus("plugin"); } } },
    b: { label: "Bypass", run: () => { const fx = currentFx(); if (fx) act("plugin.set", { id: fx.id, enabled: !fx.enabled }); } },
    x: { label: "Remove", run: () => { const fx = currentFx(); if (fx) { act("plugin.remove", { id: fx.id }); selectPlugin(null); } } },
    y: { label: "Add", run: () => { const track = selectedTrack(); if (track) useStore.setState({ picker: { trackId: track.id } }); } },
  },
  lbTap: { label: "Previous", run: () => stepFx(-1) },
  rbTap: { label: "Next", run: () => stepFx(1) },
  wheel: [
    { id: "open", label: "Open", run: () => { const fx = currentFx(); if (fx) { openPlugin(fx.id); setGamepadFocus("plugin"); } } },
    { id: "bypass", label: "Bypass", run: () => { const fx = currentFx(); if (fx) act("plugin.set", { id: fx.id, enabled: !fx.enabled }); } },
    { id: "remove", label: "Remove", run: () => { const fx = currentFx(); if (fx) act("plugin.remove", { id: fx.id }); } },
    { id: "add", label: "Add plug-in", run: () => { const track = selectedTrack(); if (track) useStore.setState({ picker: { trackId: track.id } }); } },
  ],
  onDpad: (dir) => { stepFx(dir === "left" || dir === "up" ? -1 : 1); return true; },
  onFrame: () => { const fx = currentFx(); mark(".fx-col", "data-plugin", fx?.id ?? null); },
};

function pluginId() {
  const s = useStore.getState();
  if (s.selectedPlugin && s.openPlugins.includes(s.selectedPlugin)) return s.selectedPlugin;
  return s.openPlugins.at(-1) ?? null;
}
function pluginWindow() {
  const id = pluginId();
  return id ? document.querySelector<HTMLElement>(`.fx-window[data-plugin="${CSS.escape(id)}"]`) : null;
}
let padControl = 0;
let padPlugin = "";
function pluginControls() {
  const win = pluginWindow();
  const id = pluginId() ?? "";
  if (id !== padPlugin) { padPlugin = id; padControl = 0; }
  return win ? [...win.querySelectorAll<HTMLElement>("[data-pad]")] : [];
}
function focusControl(delta: number) {
  const list = pluginControls();
  if (!list.length) return;
  padControl = (padControl + delta + list.length) % list.length;
  list.forEach((el, i) => { if (i === padControl) el.setAttribute("data-pad-focus", ""); else el.removeAttribute("data-pad-focus"); });
  list[padControl].scrollIntoView({ block: "nearest", inline: "nearest" });
}
function focusedControl() {
  const list = pluginControls();
  return list[Math.min(padControl, list.length - 1)];
}
function stepWindow(dir: number) {
  const ids = [...useStore.getState().openPlugins];
  if (!ids.length) return;
  const current = pluginId();
  const index = Math.max(0, ids.indexOf(current ?? ""));
  const next = ids[(index + dir + ids.length) % ids.length];
  useStore.setState((s) => ({ selectedPlugin: next, openPlugins: [...s.openPlugins.filter((id) => id !== next), next] }));
}
function closeCurrentPlugin() {
  const id = pluginId();
  if (!id) return;
  closePlugin(id);
  const left = useStore.getState().openPlugins;
  if (!left.length && usePad.getState().focus === "plugin") setGamepadFocus("effects");
  else if (left.length) useStore.setState({ selectedPlugin: left[left.length - 1] });
}

const plugin: Bindings = {
  title: "Plug-in",
  bare: {
    a: { label: "Toggle", run: () => focusedControl()?.dispatchEvent(new Event("pad-activate")) },
    b: { label: "Close", run: closeCurrentPlugin },
    x: { label: "Editor / list", run: () => { const win = pluginWindow(); const tabs = [...(win?.querySelectorAll<HTMLElement>(".fx-window-head .fx-seg button") ?? [])]; (tabs.find((t) => !t.classList.contains("on")) ?? tabs[0])?.click(); } },
    y: { label: "Reset", run: () => focusedControl()?.dispatchEvent(new Event("pad-reset")) },
  },
  lt: {
    a: { label: "Fine", run: () => {} },
    b: { label: "Close", run: closeCurrentPlugin },
    x: { label: "Editor / list", run: () => plugin.bare.x?.run() },
    y: { label: "Reset all", run: () => pluginWindow()?.querySelector<HTMLElement>("button[title*='Reset']")?.click() },
  },
  lbTap: { label: "Previous window", run: () => stepWindow(-1) },
  rbTap: { label: "Next window", run: () => stepWindow(1) },
  wheel: [
    { id: "bypass", label: "Bypass", run: () => pluginWindow()?.querySelector<HTMLElement>(".fx-power")?.click() },
    { id: "reset", label: "Reset all", run: () => pluginWindow()?.querySelector<HTMLElement>("button[title*='Reset']")?.click() },
    { id: "editor", label: "Editor", run: () => pluginWindow()?.querySelector<HTMLElement>(".fx-window-head .fx-seg button")?.click() },
    { id: "params", label: "All parameters", run: () => { const tabs = [...(pluginWindow()?.querySelectorAll<HTMLElement>(".fx-window-head .fx-seg button") ?? [])]; tabs[tabs.length - 1]?.click(); } },
    { id: "close", label: "Close", run: closeCurrentPlugin },
  ],
  onDpad: (dir) => { focusControl(dir === "left" || dir === "up" ? -1 : 1); return true; },
  onFrame: ({ axes, dt, layer }) => {
    const list = pluginControls();
    if (list.length) {
      padControl = Math.min(padControl, list.length - 1);
      list.forEach((el, i) => { if (i === padControl) el.setAttribute("data-pad-focus", ""); else el.removeAttribute("data-pad-focus"); });
    }
    const speed = layer === "lt" ? 0.18 : 0.7;
    if (axes.ly) focusedControl()?.dispatchEvent(new CustomEvent("pad-adjust", { detail: -axes.ly * dt * speed }));
    if (axes.lx) coalesce("plugin-x", axes.lx, 180, 0.45, (v) => focusControl(v > 0 ? 1 : -1));
  },
};

let browserIndex = 0;
function browserItems() { return [...document.querySelectorAll<HTMLElement>(".browser .b-item")]; }
function stepBrowser(dir: number) {
  const items = browserItems();
  if (!items.length) return;
  browserIndex = Math.max(0, Math.min(items.length - 1, browserIndex + dir));
  items.forEach((el, i) => { if (i === browserIndex) el.setAttribute("data-pad-focus", ""); else el.removeAttribute("data-pad-focus"); });
  if (dir) items[browserIndex]?.scrollIntoView({ block: "nearest" });
}
function stepBrowserTab(dir: number) {
  const current = useStore.getState().browserTab;
  const index = Math.max(0, BROWSER_TABS.indexOf(current));
  useStore.setState({ browserTab: BROWSER_TABS[(index + dir + BROWSER_TABS.length) % BROWSER_TABS.length] });
  browserIndex = 0;
}

const browser: Bindings = {
  title: "Browser",
  bare: {
    a: { label: "Add", run: () => browserItems()[browserIndex]?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })) },
    b: { label: "Hide", run: () => { useStore.setState({ browserOpen: false }); if (usePad.getState().focus === "browser") setGamepadFocus("arrange"); } },
    x: { label: "Import", run: () => runCommand("import") },
    y: { label: "Effects tab", run: () => useStore.setState({ browserTab: "fx" }) },
  },
  lbTap: { label: "Previous tab", run: () => stepBrowserTab(-1) },
  rbTap: { label: "Next tab", run: () => stepBrowserTab(1) },
  wheel: [
    { id: "fx", label: "Effects", run: () => useStore.setState({ browserTab: "fx" }) },
    { id: "inst", label: "Instruments", run: () => useStore.setState({ browserTab: "inst" }) },
    { id: "media", label: "Media", run: () => useStore.setState({ browserTab: "media" }) },
    { id: "chains", label: "Chains", run: () => useStore.setState({ browserTab: "chains" }) },
  ],
  onDpad: (dir) => { stepBrowser(dir === "up" || dir === "left" ? -1 : 1); return true; },
  onFrame: ({ axes }) => {
    if (Math.abs(axes.ly) > 0.65) coalesce("browser-y", axes.ly, 160, 0.65, (v) => stepBrowser(v > 0 ? 1 : -1));
    else stepBrowser(0);
  },
};

let dialogRoot: Element | null = null;
let dialogStick = 0;
const modal: Bindings = {
  title: "Dialog",
  bare: {
    a: { label: "Choose", run: () => { const root = padRoot(); if (root) crawlActivate(root); } },
    b: { label: "Close", run: closeDialog },
    x: { label: "Page down", run: () => { const root = padRoot(); if (root) crawlMove(root, 4); } },
    y: { label: "Page up", run: () => { const root = padRoot(); if (root) crawlMove(root, -4); } },
  },
  lbTap: { label: "Previous tab", run: () => { if (!cycleTabs(-1)) { const root = padRoot(); if (root) crawlMove(root, -4); } } },
  rbTap: { label: "Next tab", run: () => { if (!cycleTabs(1)) { const root = padRoot(); if (root) crawlMove(root, 4); } } },
  onDpad: (dir, layer) => {
    const root = padRoot();
    if (!root) return true;
    if (layer === "lt" && (dir === "left" || dir === "right") && cycleTabs(dir === "right" ? 1 : -1)) return true;
    crawlMove(root, dir === "down" || dir === "right" ? 1 : -1);
    return true;
  },
  onFrame: ({ axes, dt }) => {
    const root = padRoot();
    if (!root) return;
    if (root !== dialogRoot) { dialogRoot = root; dialogStick = 0; }
    crawlSync(root);
    dialogStick += axes.ly * dt;
    if (Math.abs(dialogStick) > 0.16) {
      crawlMove(root, dialogStick > 0 ? 1 : -1);
      dialogStick = 0;
    }
  },
};

function crawlBindings(title: string, rootSelector: string, close: () => void): Bindings {
  return {
    title,
    bare: {
      a: { label: "Choose", run: () => { const root = document.querySelector(rootSelector); if (root) crawlActivate(root); } },
      b: { label: "Close", run: close },
    },
    onDpad: (dir) => {
      const root = document.querySelector(rootSelector);
      if (root) crawlMove(root, dir === "down" || dir === "right" ? 1 : -1);
      return true;
    },
    onFrame: ({ axes, dt }) => {
      const root = document.querySelector(rootSelector);
      if (!root || Math.abs(axes.ly) < 0.4) return;
      coalesce(rootSelector, axes.ly * dt, 160, 0.12, (v) => crawlMove(root, v > 0 ? 1 : -1));
    },
  };
}

const keysHeld = new Map<string, number>();
function degreeNote(degree: number) {
  return clamp(baseNote() + SCALE[degree % SCALE.length], 0, 127);
}
function keyDown(id: string, degree: number) {
  if (keysHeld.has(id)) return;
  const note = degreeNote(degree);
  keysHeld.set(id, note);
  noteOn(note);
}
function keyUp(id: string) {
  const note = keysHeld.get(id);
  if (note === undefined) return;
  keysHeld.delete(id);
  noteOff(note);
}
function noteAction(id: string, degree: number) {
  return { label: `Note ${degree + 1}`, run: () => keyDown(id, degree), release: () => keyUp(id) };
}

const keyboard: Bindings = {
  title: "Keyboard",
  bare: {
    a: noteAction("a", 0),
    b: noteAction("b", 1),
    x: noteAction("x", 2),
    y: noteAction("y", 3),
  },
  lt: {
    a: { label: "Octave up", run: () => shiftOctave(1) },
    b: { label: "Octave down", run: () => shiftOctave(-1) },
    x: { label: "Louder", run: () => shiftVelocity(16) },
    y: { label: "Softer", run: () => shiftVelocity(-16) },
  },
  lbTap: { label: "Octave down", run: () => shiftOctave(-1) },
  onDpad: (dir) => {
    const degree = { up: 4, right: 5, down: 6, left: 7 }[dir];
    keyDown(dir, degree);
    window.setTimeout(() => keyUp(dir), 160);
    return true;
  },
  onFrame: ({ axes, layer }) => {
    if (layer === "rt" && Math.abs(axes.rx) > 0) {
      const note = clamp(baseNote() + Math.round((axes.rx + 1) * 12), 0, 127);
      if (perfNote !== note) playPerf(note);
    } else if (layer !== "rt" && perfNote !== null) playPerf(null);
  },
};

const editorFallback: Bindings = {
  title: "Editor",
  bare: {
    a: { label: "Open a clip", run: () => {} },
    b: { label: "Close", run: () => toggleBottom("editor") },
    x: { label: "Quantize", run: () => runCommand("quantize") },
    y: { label: "Split", run: () => runCommand("split") },
  },
  onDpad: (dir, layer) => { sharedDpad(dir, layer); return true; },
};

const welcomeFallback: Bindings = {
  title: "Start",
  bare: {
    a: { label: "Create", run: () => {} },
    x: { label: "Open", run: () => runCommand("open") },
    y: { label: "Audio setup", run: () => useStore.setState({ settingsOpen: "audio" }) },
    b: { label: "Guide", run: () => useStore.setState({ guideOpen: true }) },
  },
  onGlobal: (id) => { if (id === "palette") { useStore.setState({ guideOpen: true }); return true; } return false; },
};

const BUILTIN: Partial<Record<Region, Bindings>> = {
  arrange, mixer, effects, plugin, browser, modal, keyboard,
  editor: editorFallback,
  welcome: welcomeFallback,
  smart: crawlBindings("Smart Mix", ".dock-body", () => toggleBottom("smart")),
  assistant: crawlBindings("Assistant", ".side", () => useStore.setState({ side: null })),
  side: crawlBindings("Session", ".side", () => useStore.setState({ side: null })),
};

export function builtinBindings(region: Region): Bindings {
  return BUILTIN[region] ?? { title: region, bare: {} };
}

export function releaseHeldNotes() {
  playPerf(null);
  perfHeld = false;
  for (const id of [...keysHeld.keys()]) keyUp(id);
}
