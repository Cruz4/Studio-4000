// A small in-browser stand-in for the engine so the interface can be developed and tested without the native app.
import type { Clip, Note, Plugin, Project, Track } from "./types";
import { mockTelemetry, paramsFor, updateParam } from "./mockFx";

type Emit = (type: string, payload: unknown) => void;

let counter = 1000;
const nid = () => String(++counter);

function plugin(type: string, name: string): Plugin {
  const params = paramsFor(type) ?? [
    { id: "a", name: "Amount", value: 0.5, norm: 0.5, text: "50 %", min: 0, max: 1, automated: false },
    { id: "b", name: "Tone", value: 0.3, norm: 0.3, text: "30 %", min: 0, max: 1, automated: false },
    { id: "c", name: "Mix", value: 1, norm: 1, text: "100 %", min: 0, max: 1, automated: false },
  ];
  return {
    id: nid(), type, name, vendor: "Studio 4000", enabled: true, external: false, synth: type === "4osc", loaded: true,
    hasEditor: false, numParams: params.length, canSidechain: type === "compressor", sidechain: null, params,
  };
}

function track(name: string, kind: Track["kind"], colour: string, clips: Clip[] = []): Track {
  return {
    id: nid(), name, kind, colour, channels: 2, mute: false, solo: false, parent: null, automationMode: "read", automation: [],
    plugins: [], fxMix: 100, sends: [], volumeDb: 0, pan: 0, volumePluginId: nid(), output: "master", input: kind === "instrument" ? "MIDI Keyboard" : "Input 1 + 2",
    armed: false, monitor: "auto", live: false, cue: false, clips,
  };
}

const isLive = (t: Track) => !!t.input && (t.monitor === "on" || (t.monitor !== "off" && !!t.armed));

function audioClip(name: string, start: number, len: number, colour: string): Clip {
  return { id: nid(), name, kind: "audio", start, end: start + len, offset: 0, colour, muted: false, speed: 1, looping: false,
    file: `mock://${name}`, sourceLength: len + 4, channels: 2, gainDb: 0, pan: 0, fadeIn: 0, fadeOut: 0, pitch: 0, plugins: [], fxMix: 100 };
}

const savedChains = new Map<string, Plugin[]>();

function demoProject(name = "Night Drive"): Project {
  const vox = track("Lead Vocal", "audio", "#ff6b8b", [audioClip("Lead take 3", 8, 24, "#ff6b8b"), audioClip("Lead take 1", 36, 20, "#ff6b8b")]);
  vox.plugins = [plugin("s4000eq", "Parametric EQ"), plugin("s4000tune", "Pitch Correction"), plugin("s4000comp", "Compressor")];
  vox.clips[0].takes = { count: 3, current: 2, names: ["Take 1", "Take 2", "Take 3"] };
  vox.automation = [{ pluginId: vox.volumePluginId!, paramId: "volume", name: "Volume", min: 0, max: 1, points: [[8, 0.8, 0], [20, 0.62, 0], [30, 0.8, 0]] }];
  const beat = track("Beat", "audio", "#7c5cff", [audioClip("Beat bounce", 0, 64, "#7c5cff")]);
  const keys = track("Keys", "instrument", "#00d1ff", [{
    id: nid(), name: "Chords", kind: "midi", start: 4, end: 20, offset: 0, colour: "#00d1ff", muted: false, speed: 1, looping: false,
    notes: Array.from({ length: 16 }, (_, i) => [60 + ((i * 5) % 12), 4 + i, 0.9, 96, i * 2, 1.8] as [number, number, number, number, number, number]),
  }]);
  keys.plugins = [plugin("4osc", "4OSC Synth")];
  const plate = track("Plate", "return", "#21e6a5");
  plate.returnBus = 0;
  plate.plugins = [plugin("reverb", "Reverb")];
  vox.sends = [{ id: nid(), bus: 0, busName: "Plate", gainDb: -12, enabled: true }];
  return {
    name, file: `C:/Users/you/Music/Studio 4000/${name}/${name}.s4000`, dir: `C:/Users/you/Music/Studio 4000/${name}`, length: 64,
    bpm: 92, timeSig: [4, 4], tempos: [{ beat: 0, time: 0, bpm: 92 }],
    markers: [{ id: nid(), number: 1, name: "Verse", time: 8, colour: "#ffc857" }, { id: nid(), number: 2, name: "Hook", time: 36, colour: "#ffc857" }],
    tracks: [beat, vox, keys, plate], master: { plugins: [], volumeDb: 0, pan: 0, volumePluginId: nid() },
    buses: [{ bus: 0, name: "Plate" }], click: false, clickRecordOnly: true, clickGainDb: -6, countIn: "oneBar", punch: false,
    loop: [8, 24], looping: false, canUndo: false, canRedo: false, undoName: "", redoName: "", modified: false, sampleRate: 48000,
  };
}

export function createMock(emit: Emit) {
  let project: Project | null = null;
  let t = 0, playing = false, recording = false;
  let last = performance.now();
  const undoStack: { before: Project; name: string }[] = [];
  const redoStack: { before: Project; name: string }[] = [];
  const stampHistory = () => {
    if (!project) return;
    project.canUndo = undoStack.length > 0;
    project.undoName = undoStack.length ? undoStack[undoStack.length - 1].name : "";
    project.canRedo = redoStack.length > 0;
    project.redoName = redoStack.length ? redoStack[redoStack.length - 1].name : "";
  };

  const findTrack = (id: string) => project?.tracks.find((x) => x.id === id);
  const pluginLists = () => project
    ? [...project.tracks.map((t) => t.plugins), ...project.tracks.flatMap((t) => t.clips.map((c) => (c.plugins ??= []))), project.master.plugins]
    : [];
  const findPlugin = (id: string) => pluginLists().flat().find((x) => x.id === id);
  const targetList = (p: { trackId?: string; clipId?: string }) => {
    if (p.clipId) {
      const clip = project!.tracks.flatMap((t) => t.clips).find((c) => c.id === p.clipId);
      if (!clip || clip.kind !== "audio") return null;
      return clip.plugins ??= [];
    }
    return p.trackId === "master" ? project!.master.plugins : findTrack(p.trackId!)!.plugins;
  };
  const findClip = (id: string) => project?.tracks.flatMap((x) => x.clips).find((c) => c.id === id);
  const changed = () => { stampHistory(); emit("project", project ? structuredClone(project) : null); };

  setInterval(() => {
    const now = performance.now();
    if (playing && project) {
      t += (now - last) / 1000;
      if (project.looping && t > project.loop[1]) t = project.loop[0];
    }
    last = now;
    if (!project) return;
    const meters: Record<string, [number, number]> = {};
    for (const tr of project.tracks) {
      const active = playing && tr.clips.some((c) => t >= c.start && t < c.end);
      const v = active ? -18 + Math.sin(now / 90 + tr.name.length) * 6 + Math.random() * 4 : -100;
      meters[tr.id] = [v, v - Math.random() * 2];
    }
    const m = playing ? -14 + Math.sin(now / 400) * 3 : -100;
    emit("tick", { t, playing, recording, looping: project.looping, loop: project.loop, meters, master: [m + 3, m + 2],
      lufs: { m, s: playing ? -15 : -120, i: playing ? -15.4 : -120, peak: -1.2 }, cpu: playing ? 0.18 : 0.03 });
  }, 33);

  const handlers: Record<string, (p: any) => unknown> = {
    "collab.relay": () => ({ running: true, port: 3031, local: "ws://127.0.0.1:3031", share: "127.0.0.1:3031" }),
    "app.info": () => ({ version: "0.1.0-mock", commit: "local", projectsDir: "C:/Users/you/Music/Studio 4000", dataDir: "", hasProject: !!project,
      recent: [{ file: "C:/demo/Night Drive.s4000", name: "Night Drive", modified: new Date().toISOString() },
               { file: "C:/demo/Podcast Ep 12.s4000", name: "Podcast Ep 12", modified: new Date(Date.now() - 864e5).toISOString() }],
      onboarded: localStorage.getItem("onboarded") === "1" }),
    "settings.set": (p) => { if (p.key === "onboarded") localStorage.setItem("onboarded", "1"); localStorage.setItem("s3set:" + p.key, String(p.value)); return true; },
    "settings.get": (p) => localStorage.getItem("s3set:" + p.key) ?? "",
    "agent.setEnabled": () => true,
    "agent.setAskBeforeEdits": () => true,
    "agent.decide": () => true,
    "agent.newToken": () => "mock-token-2",
    "plugins.setPaths": () => true,
    "devices.set": () => true,
    "devices.showPanel": () => true,
    "devices.controlPanel": () => false,
    "devices.setInput": () => true,
    "export.cancel": () => true,
    "project.recover": () => true,
    "project.archive": () => "C:/demo/Bounces/archive.zip",
    "project.reveal": () => true,
    "project.get": () => project,
    "project.new": (p) => { project = demoProject(p.name || "Untitled Session"); if (p.template === "blank") { project.tracks = [track("Audio 1", "audio", "#7c5cff")]; } changed(); return project.file; },
    "project.open": () => { project = demoProject(); changed(); return true; },
    "project.save": () => { if (project) project.modified = false; emit("saved", {}); return true; },
    "project.saveAs": (p) => {
      if (!project) return false;
      const file = String(p.file || "");
      const base = file.split(/[\\/]/).pop() || project.name;
      project.name = base.replace(/\.s4000$/i, "");
      project.file = file;
      project.dir = file.replace(/[\\/][^\\/]+$/, "");
      project.modified = false;
      emit("saved", { file });
      changed();
      return file;
    },
    "transport.play": () => { playing = true; return true; },
    "transport.stop": () => { if (!playing) t = 0; playing = false; recording = false; return true; },
    "transport.toggle": () => { playing = !playing; return playing; },
    "transport.record": () => { recording = !recording; playing = recording; return recording; },
    "transport.setPosition": (p) => { t = p.time; return true; },
    "transport.setLoop": (p) => {
      if ((p.end ?? 0) - (p.start ?? 0) < 0.05) { project!.loop = [0, 0]; project!.looping = false; }
      else { project!.loop = [p.start, p.end]; if (p.enabled !== undefined) project!.looping = p.enabled; }
      changed();
      return true;
    },
    "transport.setLooping": (p) => { project!.looping = p.enabled; changed(); return true; },
    "transport.setClick": (p) => { if (p.enabled !== undefined) project!.click = p.enabled; changed(); return true; },
    "transport.setPunch": (p) => { project!.punch = p.enabled; changed(); return true; },
    "transport.setCountIn": (p) => { project!.countIn = p.mode; changed(); return true; },
    "transport.nudge": (p) => { t = Math.max(0, t + p.bars * 4 * 60 / project!.bpm); return true; },
    "transport.jumpMarker": () => true,
    "project.setTempo": (p) => { project!.bpm = p.bpm; changed(); return true; },
    "project.setTimeSig": (p) => { project!.timeSig = [p.numerator, p.denominator]; changed(); return true; },
    "track.add": (p) => { const tr = track(p.name || (p.kind === "instrument" ? "Instrument" : p.kind === "group" ? "Bus" : "Audio"), p.kind || "audio", "#4dd4ff"); if (p.kind === "audio" || p.kind === "group" || !p.kind) tr.channels = p.channels === 1 ? 1 : 2; project!.tracks.push(tr); changed(); return [tr.id]; },
    "track.remove": (p) => { project!.tracks = project!.tracks.filter((x) => x.id !== p.id); changed(); return true; },
    "track.set": (p) => {
      const tr = findTrack(p.id)!;
      if (typeof p.output === "string") {
        const bus = project!.tracks.find((x) => x.id === p.output && x.kind === "group");
        tr.parent = bus ? bus.id : project!.tracks.some((x) => x.id === tr.parent && x.kind === "group") ? null : tr.parent;
      }
      Object.assign(tr, { ...p, id: tr.id });
      changed();
      return true;
    },
    "track.arm": (p) => { const t = findTrack(p.id)!; t.armed = p.armed; t.live = isLive(t); changed(); return true; },
    "track.setMonitor": (p) => { const t = findTrack(p.id)!; t.monitor = p.mode; t.live = isLive(t); changed(); return true; },
    "track.setInput": (p) => { findTrack(p.id)!.input = p.input; changed(); return true; },
    "master.set": (p) => { Object.assign(project!.master, p); changed(); return true; },
    "clip.move": (p) => { const c = findClip(p.id)!; const len = c.end - c.start; const shift = p.start - c.start; c.start = p.start; c.end = p.start + len;
      if (c.notes) c.notes = c.notes.map((n): Note => [n[0], n[1] + shift, n[2], n[3], n[4], n[5]]);
      if (p.trackId) { const from = project!.tracks.find((x) => x.clips.includes(c))!; from.clips = from.clips.filter((x) => x !== c); findTrack(p.trackId)!.clips.push(c); }
      changed(); return true; },
    "clip.slip": (p) => { findClip(p.id)!.offset = Math.max(0, p.offset); changed(); return true; },
    "clip.trim": (p) => {
      const c = findClip(p.id)!;
      if (p.start !== undefined) {
        if (c.kind === "audio") c.offset += p.start - c.start;
        c.start = p.start;
      }
      if (p.end !== undefined) c.end = p.end;
      changed();
      return true;
    },
    "clip.split": (p) => { const c = findClip(p.id)!; const tr = project!.tracks.find((x) => x.clips.includes(c))!;
      const right = { ...structuredClone(c), id: nid(), start: p.time, offset: c.offset + p.time - c.start }; c.end = p.time; tr.clips.push(right); changed(); return right.id; },
    "clip.delete": (p) => { for (const tr of project!.tracks) tr.clips = tr.clips.filter((c) => c.id !== p.id && !(p.ids || []).includes(c.id)); changed(); return true; },
    "clip.duplicate": (p) => { const c = findClip(p.id)!; const tr = project!.tracks.find((x) => x.clips.includes(c))!; const len = c.end - c.start;
      const at = p.start ?? c.end;
      const d = { ...structuredClone(c), id: nid(), start: at, end: at + len, notes: c.notes?.map((n): Note => [n[0], n[1] + at - c.start, n[2], n[3], n[4], n[5]]) }; tr.clips.push(d); changed(); return d.id; },
    "clip.set": (p) => {
      const clip = findClip(p.id)!;
      Object.assign(clip, { ...p, id: p.id });
      if ("fadeInType" in p) delete clip.fadeInBend;
      if ("fadeOutType" in p) delete clip.fadeOutBend;
      changed();
      return true;
    },
    "clip.setGainPoints": (p) => {
      const c = findClip(p.id);
      if (!c || c.kind !== "audio") return false;
      const pts = ((p.points as number[][]) ?? [])
        .map((pt) => [Number(pt[0]), Number(pt[1])] as [number, number])
        .filter((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
        .sort((a, b) => a[0] - b[0]);
      c.gainPoints = pts;
      changed();
      return true;
    },
    "clip.setPanPoints": (p) => {
      const c = findClip(p.id);
      if (!c || c.kind !== "audio") return false;
      const pts = ((p.points as number[][]) ?? [])
        .map((pt) => [Number(pt[0]), Math.max(-1, Math.min(1, Number(pt[1])))] as [number, number])
        .filter((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
        .sort((a, b) => a[0] - b[0]);
      c.panPoints = pts;
      changed();
      return true;
    },
    "clip.addMidi": (p) => { const c: Clip = { id: nid(), name: "MIDI", kind: "midi", start: p.start, end: p.end, offset: 0, colour: "#00d1ff", muted: false, speed: 1, looping: false, notes: [] };
      findTrack(p.trackId)!.clips.push(c); changed(); return c.id; },
    "clip.toMidi": (p) => {
      const src = findClip(p.id)!;
      let dest = p.trackId ? findTrack(p.trackId) : project!.tracks.find((t) => t.kind === "instrument");
      if (!dest) { handlers["track.add"]({ kind: "instrument", name: `${src.name} MIDI` }); dest = project!.tracks[project!.tracks.length - 1]; }
      const c: Clip = { id: nid(), name: `${src.name} MIDI`, kind: "midi", start: src.start, end: src.end, offset: 0, colour: "#00d1ff", muted: false, speed: 1, looping: false, notes: [[69, src.start, src.end - src.start, 100, 0, 1]] };
      dest!.clips.push(c); changed(); return { clipId: c.id, trackId: dest!.id, notes: [[69, 0, 1, 100]] };
    },
    "clip.bounce": (p) => {
      const src = findClip(p.id)!;
      const host = project!.tracks.find((t) => t.clips.some((c) => c.id === p.id));
      const dest = { ...track(`${host?.name ?? src.name} audio`, "audio", "#21e6a5"), clips: [] as Clip[] };
      project!.tracks.push(dest);
      const c = audioClip(src.name + " audio", src.start, src.end - src.start, dest.colour);
      dest.clips.push(c); changed(); return { clipId: c.id, trackId: dest.id, file: c.file };
    },
    "midi.capture": (p) => {
      let dest = p.trackId ? findTrack(p.trackId) : project!.tracks.find((t) => t.kind === "instrument");
      if (!dest) { handlers["track.add"]({ kind: "instrument", name: "Captured MIDI" }); dest = project!.tracks[project!.tracks.length - 1]; }
      const c: Clip = { id: nid(), name: "Captured", kind: "midi", start: 0, end: 2, offset: 0, colour: "#00d1ff", muted: false, speed: 1, looping: false, notes: [[64, 0, 1, 100, 0, 1]] };
      dest!.clips.push(c); changed(); return { clipId: c.id, trackId: dest!.id, notes: [[64, 0, 1, 100]] };
    },
    "track.setCue": (p) => { findTrack(p.id)!.cue = !!p.cue; changed(); return true; },
    "midi.setNotes": (p) => { const c = findClip(p.clipId)!; const spb = 60 / project!.bpm;
      c.notes = p.notes.map((n: number[]) => [n[0], c.start + n[1] * spb, n[2] * spb, n[3] ?? 100, n[1], n[2]]); changed(); return true; },
    "plugins.list": () => ({ plugins: [
      { id: "s4000eq", name: "Parametric EQ", vendor: "Studio 4000", category: "EQ", synth: false, format: "Built-in" },
      { id: "s4000comp", name: "Compressor", vendor: "Studio 4000", category: "Dynamics", synth: false, format: "Built-in" },
      { id: "4bandEq", name: "Classic EQ", vendor: "Studio 4000", category: "EQ", synth: false, format: "Built-in" },
      { id: "compressor", name: "Classic Compressor", vendor: "Studio 4000", category: "Dynamics", synth: false, format: "Built-in" },
      { id: "s4000limiter", name: "Brickwall Limiter", vendor: "Studio 4000", category: "Dynamics", synth: false, format: "Built-in" },
      { id: "reverb", name: "Reverb", vendor: "Studio 4000", category: "Reverb", synth: false, format: "Built-in" },
      { id: "delay", name: "Delay", vendor: "Studio 4000", category: "Delay", synth: false, format: "Built-in" },
      { id: "4osc", name: "4OSC Synth", vendor: "Studio 4000", category: "Instrument", synth: true, format: "Built-in" },
      ...[["s4000tune", "Pitch Correction", "Pitch"], ["s4000gate", "Noise Gate", "Dynamics"], ["s4000deesser", "De-esser", "Dynamics"],
        ["s4000transient", "Transient Shaper", "Dynamics"], ["s4000saturator", "Saturator", "Saturation"], ["s4000crusher", "Bit Crusher", "Saturation"],
        ["s4000delay", "Stereo Delay", "Delay"], ["s4000doubler", "Vocal Doubler", "Stereo"], ["s4000width", "Stereo Width", "Stereo"],
        ["s4000tremolo", "Tremolo / Auto-pan", "Modulation"],
        ["s4000autofilter", "Auto Filter", "Filter"], ["s4000autopan", "Auto Pan", "Modulation"],
        ["s4000channel", "Channel Strip", "Dynamics"], ["s4000channel2", "Channel Strip 2", "Dynamics"],
        ["s4000djeq", "DJ EQ", "EQ"], ["s4000dualfilter", "Dual Filter", "Filter"], ["s4000expander", "Expander", "Dynamics"],
        ["s4000flanger", "Flanger", "Modulation"], ["s4000monodelay", "Mono Delay", "Delay"], ["s4000overdrive", "Overdrive", "Saturation"],
        ["s4000ringmod", "Ring Modulator", "Modulation"], ["s4000siggen", "Signal Generator", "Utility"],
        ["s4000tilteq", "Tilt EQ", "EQ"], ["s4000utility", "Utility", "Utility"], ["s4000resofilter", "Resonant Filter", "Filter"],
      ].map(([id, name, category]) => ({ id, name, vendor: "Studio 4000", category, synth: false, format: "Built-in" })),
      ...[["s4000fm", "FM Synth", "Keys"], ["s4000poly", "Analog Poly", "Keys"]].map(([id, name, category]) => ({ id, name, vendor: "Studio 4000", category, synth: true, format: "Built-in" })),
      ...[["kit:drums", "Drum Kit", "Drums & Percussion"], ["kit:808", "808 Bass", "Bass"], ["4osc:synth-bass", "Synth Bass", "Bass"], ["kit:piano", "Studio Piano", "Keys"],
        ["4osc:e-piano", "Electric Piano", "Keys"], ["4osc:organ", "Organ", "Keys"], ["4osc:warm-pad", "Warm Pad", "Pads & Strings"], ["4osc:strings", "Synth Strings", "Pads & Strings"],
        ["4osc:bright-lead", "Bright Lead", "Leads & Plucks"], ["4osc:pluck", "Pluck", "Leads & Plucks"]].map(([id, name, category]) => ({ id, name, vendor: "Studio 4000", category, synth: true, format: "Built-in" })),
      { id: "airwindows_deess", name: "AW De Ess", vendor: "Airwindows", category: "Dynamics", synth: false, format: "Built-in" },
      { id: "VST3-Pro-Q", name: "Pro EQ 3", vendor: "Example Audio", category: "EQ", synth: false, format: "VST3" },
    ], blocked: [], scanning: false, vst3Paths: "", vst2: false, unhostableVst2: 30,
      studioFolders: [{ path: "C:\\Studio 4000\\vsts", exists: false }, { path: "G:\\daw\\vsts", exists: true }] }),
    "plugins.scan": () => { emit("pluginScan", { state: "done", found: 8, failed: [] }); return true; },
    "plugin.add": (p) => {
      const entry = (handlers["plugins.list"]({}) as { plugins: { id: string; name: string; synth: boolean }[] }).plugins.find((x) => x.id === p.plugin);
      const pl = { ...plugin(p.plugin, entry?.name ?? p.plugin), synth: !!entry?.synth };
      const list = targetList(p);
      if (!list) return null;
      if (pl.synth && !p.clipId && p.trackId !== "master") {
        const old = list.findIndex((x) => x.synth);
        if (old >= 0) list.splice(old, 1);
        list.unshift(pl);
      } else list.push(pl);
      changed();
      return pl;
    },
    "plugin.remove": (p) => {
      for (const list of pluginLists()) {
        const i = list.findIndex((x) => x.id === p.id);
        if (i >= 0) list.splice(i, 1);
      }
      changed();
      return true;
    },
    "plugin.move": (p) => {
      const lists = pluginLists();
      for (const list of lists) {
        const from = list.findIndex((x) => x.id === p.id);
        if (from < 0) continue;
        const to = Math.max(0, Math.min(list.length - 1, Number(p.index)));
        const [item] = list.splice(from, 1);
        list.splice(to, 0, item);
        changed();
        return true;
      }
      return false;
    },
    "plugin.set": (p) => { for (const pl of pluginLists().flat()) if (pl.id === p.id) pl.enabled = p.enabled; changed(); return true; },
    "plugin.duplicate": (p) => {
      const home = pluginLists().find((list) => list.some((x) => x.id === p.id));
      if (!home) return null;
      const src = home.find((x) => x.id === p.id)!;
      const copy = structuredClone(src);
      copy.id = nid();
      const onto = (p.clipId || p.trackId) ? targetList(p) : null;
      if (copy.synth && p.clipId) throw new Error("Instruments belong on a track");
      if (onto && onto !== home) {
        if (copy.synth && p.trackId !== "master") {
          for (let i = onto.length - 1; i >= 0; i--) if (onto[i].synth) onto.splice(i, 1);
          onto.unshift(copy);
        } else onto.push(copy);
      } else home.splice(home.indexOf(src) + 1, 0, copy);
      changed();
      return copy;
    },
    "plugin.params": (p) => structuredClone(findPlugin(p.id)?.params ?? []),
    "plugin.setParam": (p) => {
      const pl = findPlugin(p.id);
      const r = pl && updateParam(pl.params, p.paramId, p);
      return r ? structuredClone(r) : { id: p.paramId, name: p.paramId, value: p.norm ?? p.value, norm: p.norm ?? 0.5, text: String(p.norm ?? p.value), min: 0, max: 1, automated: false };
    },
    "plugin.setParams": (p) => {
      const pl = findPlugin(p.id);
      return pl ? structuredClone(Object.entries(p.values as Record<string, number>).map(([k, v]) => updateParam(pl.params, k, { value: v })).filter(Boolean)) : [];
    },
    "plugin.telemetry": (p) => {
      const pl = findPlugin(p.id);
      const host = project?.tracks.find((tr) => tr.plugins.some((x) => x.id === p.id));
      return pl ? mockTelemetry(pl, p, playing || !!host?.live) : {};
    },
    "plugin.openEditor": () => false,
    "chain.list": () => [...savedChains.keys()].map((name) => ({ name, file: name })),
    "chain.save": (p) => {
      const list = targetList(p);
      if (!list || !p.name) return null;
      savedChains.set(String(p.name), structuredClone(list));
      return String(p.name);
    },
    "chain.setMix": (p) => {
      const raw = Number(p.mix);
      const mix = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 100));
      if (p.clipId) {
        const clip = project?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === p.clipId);
        if (clip) clip.fxMix = mix;
      } else {
        const tr = findTrack(String(p.trackId || p.id || ""));
        if (tr) tr.fxMix = mix;
      }
      changed();
      return mix;
    },
    "chain.load": (p) => {
      const saved = savedChains.get(String(p.name));
      const list = targetList(p);
      if (!saved || !list) return 0;
      for (const item of structuredClone(saved)) {
        item.id = nid();
        if (item.synth && !p.clipId) {
          const old = list.findIndex((x) => x.synth);
          if (old >= 0) list.splice(old, 1);
          list.unshift(item);
        } else list.push(item);
      }
      changed();
      return saved.length;
    },
    "media.peaks": (p) => {
      const bpsAsk = Math.min(8000, Math.max(32, Number(p.binsPerSecond) || 200));
      const start = Math.max(0, Number(p.start) || 0);
      const length = Number(p.length) > 0 ? Number(p.length) : 70;
      let bins = Math.ceil(length * bpsAsk);
      const bps = bins > 12000 ? 12000 / length : bpsAsk;
      bins = Math.max(1, Math.min(12000, Math.ceil(length * bps)));
      const bytes = new Int8Array(bins * 4);
      for (let i = 0; i < bins; i++) {
        const time = start + i / bps;
        const left = 0.2 + 0.7 * Math.abs(Math.sin(time * 17.3));
        const right = 0.12 + 0.4 * Math.abs(Math.sin(time * 9.1 + 1.4));
        const lv = Math.round(left * 127), rv = Math.round(right * 127);
        bytes[i * 4] = -lv; bytes[i * 4 + 1] = Math.round(lv * 0.72);
        bytes[i * 4 + 2] = -Math.round(rv * 0.55); bytes[i * 4 + 3] = rv;
      }
      let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b & 255)));
      return { file: p.file, binsPerSecond: bps, start, length, sampleRate: 48000, channels: 2, data: btoa(s) };
    },
    "media.list": () => [{ file: "C:/demo/Audio/Lead take 3.wav", name: "Lead take 3.wav", folder: "Audio", size: 4.2e6 }],
    "edit.undo": () => {
      const step = undoStack.pop();
      if (!step || !project) return false;
      redoStack.push({ before: structuredClone(project), name: step.name });
      project = step.before;
      changed();
      return true;
    },
    "edit.redo": () => {
      const step = redoStack.pop();
      if (!step || !project) return false;
      undoStack.push({ before: structuredClone(project), name: step.name });
      project = step.before;
      changed();
      return true;
    },
    "edit.history": () => ({
      undo: undoStack.map((s) => s.name).reverse(),
      redo: redoStack.map((s) => s.name).reverse(),
    }),
    "edit.jump": (p) => {
      const steps = Number(p.steps) || 0;
      const n = Math.abs(steps);
      for (let i = 0; i < n; i++) (steps > 0 ? handlers["edit.undo"] : handlers["edit.redo"])({});
      return true;
    },
    "smart.analyze": () => ({
      tracks: project!.tracks.map((tr) => ({ id: tr.id, name: tr.name, role: "music", lufs: -20 + Math.random() * 8, peakDb: -3, lra: 5, activeSeconds: 30, hasAudio: true })),
      master: { lufs: -16.8, peakDb: -0.4, lra: 6.1, correlation: 0.62, lowEndRatio: 0.38 },
      issues: [{ level: "warning", message: "Master peaks above -1 dBFS; streaming encoders may distort it.", fix: "smart.master" },
               { level: "info", message: "Lead Vocal is 7 LU louder than Double. Gain staging evens them out.", fix: "smart.gainStage" }] }),
    "smart.mix": (p) => ({ summary: "Smart Mix: 4 step(s), 9 change(s)", applied: !!p.apply,
      steps: [{ title: "Gain staging", summary: "Gain stage 3 track(s) to -18 LUFS before plug-ins", details: [] },
              { title: "Balance", summary: "Set faders by role (lead parts up front, backing parts under)", details: [] },
              { title: "Mastering", summary: "Master from -16.8 to about -14 LUFS with a -1.0 dB ceiling", details: [] }],
      calls: [{ method: "track.set", params: { id: project!.tracks[1].id, volumeDb: 0 } }, { method: "plugin.add", params: { trackId: "master", plugin: "s4000limiter" } }] }),
    "smart.gainStage": () => ({ summary: "Gain stage 2 track(s) to -18 LUFS", details: [], calls: [] }),
    "smart.master": () => ({ summary: "Master from -16.8 to about -14 LUFS", details: [], calls: [] }),
    "smart.duck": () => ({ summary: "Duck Beat by 6 dB in 12 place(s)", details: [], calls: [] }),
    "smart.vocalChain": (p) => {
      const t = project!.tracks.find((x) => x.id === p.trackId)!;
      if (p.apply) {
        for (const name of ["Equaliser", "Compressor"]) if (!t.plugins.some((x) => x.name === name))
          t.plugins.push({ id: `p${Math.random().toString(36).slice(2, 8)}`, name, type: name.toLowerCase(), enabled: true, synth: false } as never);
        changed();
      }
      return { summary: `Vocal chain (${p.style ?? "pop"}) on ${t.name}`, applied: !!p.apply, details: [], calls: [] };
    },
    "batch.run": (p) => p.calls.map((c: { method: string; params: unknown }) => handlers[c.method]?.(c.params)),
    "ai.context": () => `Project "${project?.name}" with ${project?.tracks.length} tracks`,
    "ai.tools": () => [],
    "app.describe": () => [],
    "devices.get": () => ({ type: "Windows Audio", input: "Microphone", output: "Speakers", types: [{ name: "Windows Audio", inputs: ["Microphone"], outputs: ["Speakers"] }, { name: "ASIO", inputs: ["Focusrite USB ASIO"], outputs: ["Focusrite USB ASIO"] }],
      current: { name: "Speakers", type: "Windows Audio", sampleRate: 48000, bufferSize: 256, sampleRates: [44100, 48000, 96000], bufferSizes: [64, 128, 256, 512, 1024], inputLatencyMs: 6.1, outputLatencyMs: 7.3, hasControlPanel: false },
      waveInputs: [{ name: "Input 1 + 2", enabled: true, stereo: true }, { name: "Input 1", enabled: true, stereo: false }],
      waveOutputs: [{ name: "Output 1 + 2", enabled: true }, { name: "Output 3 + 4", enabled: true }], masterOutput: "Output 1 + 2",
      midiInputs: [{ name: "All MIDI Ins", enabled: true, virtual: true }, { name: "MIDI Keyboard", enabled: true, virtual: false }], cpu: 0.05 }),
    "devices.setMasterOutput": () => true,
    "midi.live": (p) => p.trackId ?? "",
    "midi.focus": () => true,
    "midi.panic": () => true,
    "agent.status": () => ({ enabled: true, running: true, port: 30303, askBeforeEdits: true, clients: 0, configFile: "%APPDATA%/Studio4000/agent.json" }),
    "export.render": () => { setTimeout(() => emit("render", { job: 1, state: "done", files: ["C:/demo/Bounces/Night Drive.wav"], errors: "" }), 1500); return 1; },
  };

  return {
    async native(name: string, params: unknown[]): Promise<unknown> {
      if (name === "rpc") {
        const [method, p] = params as [string, any];
        const h = handlers[method];
        await new Promise((r) => setTimeout(r, 5));
        if (!h) return { ok: true, result: null };
        const undoable = new Set(["track.add", "track.remove", "track.set", "track.arm", "track.move", "track.duplicate",
          "clip.move", "clip.slip", "clip.trim", "clip.split", "clip.delete", "clip.duplicate", "clip.set", "clip.setGainPoints", "clip.setPanPoints", "clip.importAudio", "clip.addMidi", "clip.normalize", "clip.stretch",
          "plugin.add", "plugin.remove", "plugin.move", "plugin.duplicate", "plugin.set", "master.set", "chain.load", "batch.run",
          "midi.setNotes", "midi.addNote", "midi.quantize", "midi.transpose"]);
        if (project && undoable.has(method)) {
          const names: Record<string, string> = {
            "plugin.add": "Add effect", "plugin.remove": "Remove effect", "plugin.move": "Reorder effect", "plugin.duplicate": "Duplicate effect",
            "plugin.set": "Effect bypass", "chain.load": "Load effect chain", "clip.move": "Move clip", "clip.delete": "Delete clip",
            "clip.split": "Split", "clip.duplicate": "Duplicate", "clip.trim": "Trim", "clip.slip": "Slip", "clip.set": "Clip change",
            "clip.addMidi": "New MIDI clip", "clip.normalize": "Normalize", "clip.setGainPoints": "Clip gain", "clip.setPanPoints": "Clip pan", "track.add": "New track", "track.remove": "Delete track",
            "master.set": "Master volume", "midi.setNotes": "Edit notes", "batch.run": "Edit",
          };
          undoStack.push({ before: structuredClone(project), name: method === "batch.run" ? (p?.label || "Edit") : (names[method] ?? "Edit") });
          redoStack.length = 0;
        }
        try {
          return { ok: true, result: h(p ?? {}) };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      }
      if (name === "secret") {
        if (params[1] !== undefined) localStorage.setItem("secret" + params[0], String(params[1]));
        return localStorage.getItem("secret" + params[0]) ?? "";
      }
      if (name === "pickFile") return [];
      if (name === "agentInfo") return { port: 30303, token: "mock-token", configFile: "%APPDATA%/Studio4000/agent.json", mcpServer: "mcp/index.mjs" };
      if (name === "checkUpdate") return { state: "current" };
      if (name === "http") {
        const req = params[0] as { url: string; method?: string; headers?: Record<string, string>; body?: string };
        const r = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
        return { status: r.status, body: await r.text() };
      }
      return true;
    },
  };
}
