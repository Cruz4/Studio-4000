import { native, rpc } from "./bridge";
import { COFFEE_URL, supportMailto } from "./support";
import { panic, shiftOctave, toggleTyping } from "./keys";
import { act, type BrowserTab, live, refreshInfo, selectTrack, toast, useStore } from "./store";
import type { Clip, Track } from "./types";
import { AUDIO_FILTER, gridSeconds, secondsPerBar, secondsPerBeat } from "./util";

export interface Command {
  id: string;
  group: string;
  title: string;
  keys?: string;
  run: () => unknown;
  when?: () => boolean;
  /** For toggles: shows a tick in menus while on. */
  checked?: () => boolean;
}

const S = () => useStore.getState();
const hasProject = () => !!S().project;

/** Asks the public project whether a newer build is published, then restarts into it. */
export async function checkForUpdates() {
  const transport = S().transport;
  if (transport.playing || transport.recording) {
    toast("Stop playback or recording, then check for updates again.");
    return;
  }
  toast("Looking for a newer build…");
  const result = await native.checkUpdate().catch(() => ({ state: "failed" as const }));
  if (result.state === "current") toast("Studio 4000 is already up to date.", "success");
  else if (result.state === "staged") toast("Installing the latest build. Studio 4000 will reopen.", "success");
  else if (result.state === "offline") toast("Couldn't reach the update. Check that this computer is online.", "error");
  else if (result.state === "busy") toast("Already looking for an update.");
  else if (result.state === "skipped") toast("This copy was built on this computer, so it does not replace itself.");
  else toast("The update didn't finish. Try again in a moment.", "error");
}

export function selectedTrack(): Track | undefined {
  const s = S();
  return s.project?.tracks.find((t) => t.id === s.selectedTrack) ?? s.project?.tracks[0];
}

export function selectedClips(): Clip[] {
  const s = S();
  const ids = new Set(s.selectedClips);
  return s.project?.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id))) ?? [];
}

export async function importAudio(trackId?: string, start?: number) {
  const files = await native.pickFile({ mode: "open", title: "Import audio", filters: AUDIO_FILTER, multiple: true });
  if (!files?.length) return;
  let target = trackId ?? selectedTrack()?.id;
  if (!target || S().project?.tracks.find((t) => t.id === target)?.kind !== "audio") {
    const ids = await act("track.add", { kind: "audio", name: "Audio" });
    target = ids?.[0];
  }
  let at = start ?? live.tick.t;
  for (const f of files) {
    const id = await act("clip.importAudio", { trackId: target, file: f, start: at });
    const clip = S().project?.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    if (clip) at = clip.end;
  }
}

export async function openProject() {
  const files = await native.pickFile({ mode: "open", title: "Open project", filters: "*.s4000;*.s3030", dir: S().info?.projectsDir });
  if (files?.[0]) {
    await act("project.open", { file: files[0] });
    refreshInfo();
  }
}

export async function addTrack(kind: Track["kind"] = "audio", place: { afterId?: string; beforeId?: string } = {}) {
  const at = { afterId: place.afterId ?? (place.beforeId ? undefined : S().selectedTrack ?? undefined), beforeId: place.beforeId };
  if (kind === "return") return act("bus.create", { name: "FX Return", effect: "reverb", ...at });
  const ids = await act("track.add", { kind, ...at });
  if (ids?.[0]) selectTrack(ids[0]);
}

let clipClipboard: { ids: string[]; cut: boolean } | null = null;

export function copySelection() {
  const ids = S().selectedClips;
  if (!ids.length) return toast("Select a clip first");
  clipClipboard = { ids: [...ids], cut: false };
  toast(ids.length === 1 ? "Clip copied" : `${ids.length} clips copied`);
}

export function cutSelection() {
  const ids = S().selectedClips;
  if (!ids.length) return toast("Select a clip first");
  clipClipboard = { ids: [...ids], cut: true };
  toast(ids.length === 1 ? "Clip cut" : `${ids.length} clips cut`);
}

export async function pasteClips(time?: number, trackId?: string) {
  if (!clipClipboard?.ids.length) return toast("Nothing to paste");
  const p = S().project;
  const clips = clipClipboard.ids.map((id) => p?.tracks.flatMap((t) => t.clips.map((c) => ({ c, trackId: t.id }))).find((x) => x.c.id === id)).filter((x): x is { c: Clip; trackId: string } => !!x);
  if (!clips.length) return toast("The copied clips are gone");
  const origin = Math.min(...clips.map((x) => x.c.start));
  const at = time ?? live.tick.t;
  const dest = trackId ?? clips[0].trackId;
  const made: string[] = [];
  const cutIds: string[] = [];
  for (const { c, trackId: source } of clips) {
    const start = Math.max(0, at + (c.start - origin));
    const id = await act("clip.duplicate", { id: c.id, start });
    if (typeof id === "string") {
      made.push(id);
      cutIds.push(c.id);
      if (dest !== source) await act("clip.move", { id, start, trackId: dest });
    }
  }
  if (clipClipboard.cut && cutIds.length) {
    await act("batch.run", { label: "Cut clips", calls: cutIds.map((id) => ({ method: "clip.delete", params: { id } })) });
    clipClipboard = null;
  }
  if (made.length) useStore.setState({ selectedClips: made, selectedPlugin: null });
}

export function splitClipAt(id: string, time: number) {
  return act("clip.split", { id, time });
}

export function splitAtPlayhead() {
  const t = live.tick.t;
  const sel = selectedClips();
  const targets = sel.length ? sel : (selectedTrack()?.clips ?? []);
  const hit = targets.filter((c) => t > c.start && t < c.end);
  if (!hit.length) return toast("Put the playhead over a clip to split it");
  return rpc("batch.run", { label: "Split", calls: hit.map((c) => ({ method: "clip.split", params: { id: c.id, time: t } })) }).catch((e) => toast(e.message, "error"));
}

export function deleteSelection() {
  const s = S();
  if (s.selectedPlugin && !s.selectedClips.length) {
    const id = s.selectedPlugin;
    useStore.setState({ selectedPlugin: null, openPlugins: s.openPlugins.filter((x) => x !== id) });
    act("plugin.remove", { id });
    return;
  }
  const sel = s.selectedClips;
  if (!sel.length) return;
  act("batch.run", { label: "Delete clips", calls: sel.map((id) => ({ method: "clip.delete", params: { id } })) });
  useStore.setState({ selectedClips: [] });
}

/** Moves the selected clips by one snap step, or onto the neighbouring track. */
export function nudgeSelection(key: string, shift: boolean) {
  const project = S().project;
  const ids = new Set(S().selectedClips);
  if (!project || !ids.size) return false;
  const located = project.tracks.flatMap((track, index) => track.clips.filter((c) => ids.has(c.id)).map((c) => ({ c, index })));
  if (!located.length) return false;

  if (key === "ArrowLeft" || key === "ArrowRight") {
    const step = shift ? secondsPerBar(project) : (gridSeconds(S().grid, project) || secondsPerBeat(project));
    const dir = key === "ArrowLeft" ? -1 : 1;
    act("batch.run", {
      label: "Move clip",
      calls: located.map(({ c }) => ({ method: "clip.move", params: { id: c.id, start: Math.max(0, c.start + dir * step) } })),
    });
    return true;
  }

  if (key === "ArrowUp" || key === "ArrowDown") {
    const dir = key === "ArrowUp" ? -1 : 1;
    const calls = located.flatMap(({ c, index }) => {
      const dest = project.tracks[index + dir];
      return dest ? [{ method: "clip.move", params: { id: c.id, start: c.start, trackId: dest.id } }] : [];
    });
    if (calls.length) act("batch.run", { label: "Move clip", calls });
    return true;
  }
  return false;
}

export function duplicateSelection() {
  const sel = S().selectedClips;
  if (!sel.length) return;
  act("batch.run", { label: "Duplicate", calls: sel.map((id) => ({ method: "clip.duplicate", params: { id } })) });
}

export async function toggleRecord() {
  const s = S();
  if (s.transport.recording) return act("transport.stop");
  if (!s.project?.tracks.some((t) => t.armed)) {
    const tr = selectedTrack();
    if (tr && (tr.kind === "audio" || tr.kind === "instrument")) await act("track.arm", { id: tr.id, armed: true });
  }
  return act("transport.record");
}

export async function vocalChain(trackId?: string, style: "pop" | "warm" | "podcast" = "pop") {
  const id = trackId ?? selectedTrack()?.id;
  if (!id) return toast("Select a vocal track first");
  const r = await act("smart.vocalChain", { trackId: id, style, apply: true });
  if (r) toast(r.summary, "success", { action: { label: "Undo", run: () => act("edit.undo") } });
}

/** Overlapping clips on the same track fade into each other across the overlap. */
export function crossfadeSelection() {
  const p = S().project;
  const sel = new Set(S().selectedClips);
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  for (const t of p?.tracks ?? []) {
    const clips = t.clips.filter((c) => c.kind === "audio" && (!sel.size || sel.has(c.id))).sort((a, b) => a.start - b.start);
    for (let i = 0; i + 1 < clips.length; i++) {
      const a = clips[i], b = clips[i + 1];
      const overlap = a.end - b.start;
      const len = overlap > 0.005 ? overlap : 0;
      if (!len) continue;
      calls.push({ method: "clip.set", params: { id: a.id, fadeOut: len, fadeOutType: "scurve" } });
      calls.push({ method: "clip.set", params: { id: b.id, fadeIn: len, fadeInType: "scurve" } });
    }
  }
  if (!calls.length) return toast("Overlap two clips on the same track to crossfade them");
  return act("batch.run", { label: "Crossfade", calls });
}

export async function addMidiClip(trackId?: string, at?: number) {
  const target = trackId ?? (selectedTrack()?.kind === "instrument" ? selectedTrack()!.id : S().project?.tracks.find((t) => t.kind === "instrument")?.id);
  if (!target) return toast("Add an instrument track first (Ctrl+Shift+T)");
  const bar = secondsPerBar(S().project);
  const start = Math.floor((at ?? live.tick.t) / bar) * bar;
  const id = await act("clip.addMidi", { trackId: target, start, end: start + bar * 4, name: "MIDI" });
  if (id) useStore.setState({ editorClip: id, bottom: "editor", selectedClips: [id] });
}

export function showBrowser(tab: BrowserTab) {
  useStore.setState({ browserOpen: true, browserTab: tab });
}

export function toggleBottom(tab: "effects" | "mixer" | "editor" | "smart") {
  useStore.setState((s) => ({ bottom: s.bottom === tab ? null : tab }));
}

/** One click between the track list and the full-page mixer. */
export function toggleMixerView() {
  useStore.setState((s) => ({ view: s.view === "mixer" ? "tracks" : "mixer" }));
}

const insertsOf = (trackId: string) => {
  const p = S().project;
  const owner = trackId === "master" ? p?.master : p?.tracks.find((t) => t.id === trackId);
  return owner?.plugins.filter((x) => !x.synth) ?? [];
};

export const trackFxOn = (plugins: { synth?: boolean; enabled: boolean }[]) => plugins.some((x) => !x.synth && x.enabled);

/** Which effects were on when a track's FX were switched off, so switching back on restores exactly those. */
const fxMemory = new Map<string, string[]>();

/** Bypasses every insert on a track (or "master") in one undo step, or brings them back. */
export function toggleTrackFx(trackId: string) {
  const inserts = insertsOf(trackId);
  if (!inserts.length) return toast("No effects on this track yet. Click + to add one");
  const on = inserts.filter((x) => x.enabled);
  let ids: string[], enabled: boolean;
  if (on.length) {
    fxMemory.set(trackId, on.map((x) => x.id));
    ids = on.map((x) => x.id); enabled = false;
  } else {
    const remembered = fxMemory.get(trackId)?.filter((id) => inserts.some((x) => x.id === id));
    ids = remembered?.length ? remembered : inserts.map((x) => x.id); enabled = true;
    fxMemory.delete(trackId);
  }
  return act("batch.run", { label: enabled ? "Effects on" : "Effects off", calls: ids.map((id) => ({ method: "plugin.set", params: { id, enabled } })) });
}

export function zoom(f: number) {
  useStore.setState((s) => ({ pxPerSec: Math.min(1200, Math.max(4, s.pxPerSec * f)) }));
}

/** Fits the timeline to every clip, with a small margin and nothing else in view. */
export function zoomToClips() {
  const p = S().project;
  if (!p) return;
  const clips = p.tracks.flatMap((t) => t.clips);
  const el = document.querySelector<HTMLElement>(".arrange-body");
  const w = Math.max(200, (el?.clientWidth ?? 1200) - 260);
  const margin = 24;
  if (!clips.length) {
    const len = Math.max(p.length, secondsPerBar(p) * 8);
    useStore.setState({ pxPerSec: Math.max(4, Math.min(1200, w / len)) });
    if (el) el.scrollLeft = 0;
    return;
  }
  const start = Math.min(...clips.map((c) => c.start));
  const end = Math.max(...clips.map((c) => c.end));
  const pps = Math.max(4, Math.min(1200, (w - margin * 2) / Math.max(0.25, end - start)));
  useStore.setState({ pxPerSec: pps });
  const apply = () => { if (el) el.scrollLeft = Math.max(0, start * pps - margin); };
  apply();
  requestAnimationFrame(apply);
}

export const commands: Command[] = [
  { id: "play", group: "Transport", title: "Play / Stop", keys: "Space", run: () => act("transport.toggle"), when: hasProject },
  { id: "record", group: "Transport", title: "Record", keys: "R", run: toggleRecord, when: hasProject },
  { id: "stop", group: "Transport", title: "Stop (again: return to start)", keys: "Enter", run: () => act("transport.stop"), when: hasProject },
  { id: "home", group: "Transport", title: "Go to start", keys: "Home", run: () => act("transport.setPosition", { time: 0 }), when: hasProject },
  { id: "end", group: "Transport", title: "Go to end", keys: "End", run: () => act("transport.setPosition", { time: S().project?.length ?? 0 }), when: hasProject },
  { id: "prevBar", group: "Transport", title: "Back one bar", keys: ",", run: () => act("transport.nudge", { bars: -1 }), when: hasProject },
  { id: "nextBar", group: "Transport", title: "Forward one bar", keys: ".", run: () => act("transport.nudge", { bars: 1 }), when: hasProject },
  { id: "loop", group: "Transport", title: "Toggle loop", keys: "L", run: () => act("transport.setLooping", { enabled: !S().project?.looping }), when: hasProject },
  { id: "loopSel", group: "Transport", title: "Loop selected clips", keys: "Shift+L", when: hasProject, run: () => {
    const c = selectedClips();
    if (!c.length) return toast("Select clips first");
    act("transport.setLoop", { start: Math.min(...c.map((x) => x.start)), end: Math.max(...c.map((x) => x.end)), enabled: true });
  } },
  { id: "click", group: "Transport", title: "Toggle metronome", keys: "C", run: () => act("transport.setClick", { enabled: !S().project?.click }), when: hasProject },
  { id: "punch", group: "Transport", title: "Toggle punch in/out (records only inside the loop)", keys: "P", run: () => act("transport.setPunch", { enabled: !S().project?.punch }), when: hasProject },
  { id: "marker", group: "Transport", title: "Add marker at playhead", keys: "M", run: () => act("marker.add", { time: live.tick.t }), when: hasProject },

  { id: "undo", group: "Edit", title: "Undo", keys: "Ctrl+Z", run: () => act("edit.undo"), when: hasProject },
  { id: "history", group: "Edit", title: "History", run: () => useStore.setState((s) => ({ historyOpen: !s.historyOpen })), when: hasProject },
  { id: "redo", group: "Edit", title: "Redo", keys: "Ctrl+Y", run: () => act("edit.redo"), when: hasProject },
  { id: "split", group: "Edit", title: "Split at playhead", keys: "S", run: splitAtPlayhead, when: hasProject },
  { id: "toolMove", group: "Edit", title: "Move tool", keys: "1", when: hasProject, run: () => useStore.setState({ tool: "move" }) },
  { id: "toolTime", group: "Edit", title: "Time tool", keys: "2", when: hasProject, run: () => useStore.setState({ tool: "time" }) },
  { id: "toolSplit", group: "Edit", title: "Split tool", keys: "3", when: hasProject, run: () => useStore.setState({ tool: "split" }) },
  { id: "toolSlip", group: "Edit", title: "Slip tool", keys: "4", when: hasProject, run: () => useStore.setState({ tool: "slip" }) },
  { id: "toolErase", group: "Edit", title: "Erase tool", keys: "5", when: hasProject, run: () => useStore.setState({ tool: "erase" }) },
  { id: "toolCycle", group: "Edit", title: "Cycle arrange tool", keys: "`", when: hasProject, run: () => {
    const order = ["move", "time", "split", "slip", "erase"] as const;
    const i = Math.max(0, order.indexOf(S().tool));
    useStore.setState({ tool: order[(i + 1) % order.length] });
  } },
  { id: "delete", group: "Edit", title: "Delete selected clips or effect", keys: "Delete", run: deleteSelection, when: hasProject },
  { id: "duplicate", group: "Edit", title: "Duplicate selected clips", keys: "Ctrl+D", run: duplicateSelection, when: hasProject },
  { id: "cut", group: "Edit", title: "Cut selected clips", keys: "Ctrl+X", run: cutSelection, when: hasProject },
  { id: "copy", group: "Edit", title: "Copy selected clips", keys: "Ctrl+C", run: copySelection, when: hasProject },
  { id: "paste", group: "Edit", title: "Paste clips at the playhead", keys: "Ctrl+V", run: () => pasteClips(), when: hasProject },
  { id: "selectAll", group: "Edit", title: "Select all clips", keys: "Ctrl+A", when: hasProject,
    run: () => useStore.setState({ selectedClips: S().project?.tracks.flatMap((t) => t.clips.map((c) => c.id)) ?? [], selectedPlugin: null }) },
  { id: "normalize", group: "Edit", title: "Normalize selected clips to -1 dB", when: hasProject,
    run: () => act("batch.run", { label: "Normalize", calls: selectedClips().filter((c) => c.kind === "audio").map((c) => ({ method: "clip.normalize", params: { id: c.id, peakDb: -1 } })) }) },
  { id: "muteClip", group: "Edit", title: "Mute or unmute selected clips", keys: "Shift+M", when: hasProject,
    run: () => act("batch.run", { label: "Mute clips", calls: selectedClips().map((c) => ({ method: "clip.set", params: { id: c.id, muted: !c.muted } })) }) },
  { id: "crossfade", group: "Edit", title: "Crossfade overlapping clips", keys: "X", run: crossfadeSelection, when: hasProject },
  { id: "quantize", group: "Edit", title: "Quantize selected MIDI to 1/16", keys: "Q", when: hasProject,
    run: () => act("batch.run", { label: "Quantize", calls: selectedClips().filter((c) => c.kind === "midi").map((c) => ({ method: "midi.quantize", params: { clipId: c.id, grid: 0.25 } })) }) },

  { id: "addAudio", group: "Track", title: "New audio track", keys: "Ctrl+T", run: () => addTrack("audio"), when: hasProject },
  { id: "addInst", group: "Track", title: "New instrument track", keys: "Ctrl+Shift+T", run: () => addTrack("instrument"), when: hasProject },
  { id: "addBus", group: "Track", title: "New FX return (reverb)", run: () => addTrack("return"), when: hasProject },
  { id: "addGroup", group: "Track", title: "New group / submix", run: () => addTrack("group"), when: hasProject },
  { id: "arm", group: "Track", title: "Arm selected track", keys: "Shift+R", when: hasProject,
    run: () => { const t = selectedTrack(); if (t) act("track.arm", { id: t.id, armed: !t.armed }); } },
  { id: "muteTrack", group: "Track", title: "Mute selected track", when: hasProject,
    run: () => { const t = selectedTrack(); if (t) act("track.set", { id: t.id, mute: !t.mute }); } },
  { id: "soloTrack", group: "Track", title: "Solo selected track", when: hasProject,
    run: () => { const t = selectedTrack(); if (t) act("track.set", { id: t.id, solo: !t.solo }); } },
  { id: "import", group: "Track", title: "Import audio files…", keys: "Ctrl+I", run: () => importAudio(), when: hasProject },

  { id: "mixerView", group: "View", title: "Full-page mixer (again: back to tracks)", keys: "F3", run: toggleMixerView, when: hasProject, checked: () => S().view === "mixer" },
  { id: "trackFx", group: "Track", title: "Effects on/off for selected track", keys: "Shift+F", when: hasProject, run: () => { const t = S().selectedTrack; if (t) toggleTrackFx(t); } },
  { id: "effectsPanel", group: "View", title: "Effects panel for the selected track", run: () => toggleBottom("effects"), when: hasProject, checked: () => S().bottom === "effects" },
  { id: "mixer", group: "View", title: "Mixer panel", keys: "Tab", run: () => toggleBottom("mixer"), when: hasProject, checked: () => S().bottom === "mixer" },
  { id: "editor", group: "View", title: "Clip editor / piano roll", keys: "E", run: () => toggleBottom("editor"), when: hasProject, checked: () => S().bottom === "editor" },
  { id: "smart", group: "View", title: "Smart Mix & health report", keys: "Ctrl+M", run: () => toggleBottom("smart"), when: hasProject, checked: () => S().bottom === "smart" },
  { id: "browser", group: "View", title: "Browser panel", keys: "B", run: () => useStore.setState((s) => ({ browserOpen: !s.browserOpen })), checked: () => S().browserOpen },
  { id: "effects", group: "View", title: "Browse effects", run: () => showBrowser("fx") },
  { id: "instruments", group: "MIDI", title: "Browse instruments", run: () => showBrowser("inst") },

  { id: "typing", group: "MIDI", title: "Musical typing (play notes on the computer keyboard)", keys: "Shift+K", when: hasProject, run: () => toggleTyping(), checked: () => S().typing },
  { id: "keyboard", group: "MIDI", title: "On-screen keyboard", when: hasProject, run: () => useStore.setState((s) => ({ keysOpen: !s.keysOpen })), checked: () => S().keysOpen },
  { id: "octaveDown", group: "MIDI", title: "Keyboard octave down (Z while typing)", run: () => shiftOctave(-1), when: hasProject },
  { id: "octaveUp", group: "MIDI", title: "Keyboard octave up (X while typing)", run: () => shiftOctave(1), when: hasProject },
  { id: "panic", group: "MIDI", title: "MIDI panic (stop all notes)", run: panic, when: hasProject },
  { id: "newMidiClip", group: "MIDI", title: "New MIDI clip at playhead", when: hasProject, run: () => addMidiClip() },
  { id: "palette", group: "Help", title: "Command palette", keys: "Ctrl+K", run: () => useStore.setState({ paletteOpen: true }) },
  { id: "quit", group: "Project", title: "Quit", run: () => native.window("quit") },
  { id: "assistant", group: "View", title: "AI assistant", keys: "Ctrl+J", run: () => useStore.setState((s) => ({ side: s.side === "assistant" ? null : "assistant" })) },
  { id: "collab", group: "View", title: "Collaborate (share session, screen, voice)", keys: "Ctrl+Shift+C", run: () => useStore.setState((s) => ({ side: s.side === "collab" ? null : "collab" })) },
  { id: "automation", group: "View", title: "Show volume automation for selected track", keys: "A", when: hasProject, run: () => {
    const t = selectedTrack();
    if (!t) return;
    useStore.setState((s) => ({ automationOpen: { ...s.automationOpen, [t.id]: s.automationOpen[t.id] ? null : `${t.volumePluginId}:volume` } }));
  } },
  { id: "zoomIn", group: "View", title: "Zoom in", keys: "=", run: () => zoom(1.4) },
  { id: "zoomOut", group: "View", title: "Zoom out", keys: "-", run: () => zoom(1 / 1.4) },
  { id: "zoomFit", group: "View", title: "Zoom so every clip is visible", keys: "Shift+Z", when: hasProject, run: () => zoomToClips() },
  { id: "fullscreen", group: "View", title: "Full screen", keys: "F11", run: () => native.window("fullscreen") },
  { id: "shortcuts", group: "Help", title: "Keyboard shortcuts", keys: "?", run: () => useStore.setState({ shortcutsOpen: true }) },
  { id: "guide", group: "Help", title: "How Studio 4000 works", run: () => useStore.setState({ guideOpen: true }) },
  { id: "checkUpdate", group: "Help", title: "Check for updates", run: () => checkForUpdates() },
  { id: "whatsNew", group: "Help", title: "What's new", run: () => useStore.setState({ aboutOpen: true }) },
  { id: "coffee", group: "Help", title: "Buy me a coffee", run: () => native.openUrl(COFFEE_URL) },
  { id: "report", group: "Help", title: "Report a bug or idea", run: () => native.openUrl(supportMailto(S().info?.version)) },

  { id: "save", group: "Project", title: "Save", keys: "Ctrl+S", run: () => act("project.save"), when: hasProject },
  { id: "open", group: "Project", title: "Open project…", keys: "Ctrl+O", run: openProject },
  { id: "new", group: "Project", title: "New project…", keys: "Ctrl+N", run: () => useStore.setState({ project: null }) },
  { id: "export", group: "Project", title: "Export mix or stems…", keys: "Ctrl+E", run: () => useStore.setState({ exportOpen: true }), when: hasProject },
  { id: "archive", group: "Project", title: "Archive project (zip with audio)", run: () => act("project.archive"), when: hasProject },
  { id: "reveal", group: "Project", title: "Show project folder", run: () => act("project.reveal", {}), when: hasProject },
  { id: "settings", group: "Project", title: "Settings", keys: "Ctrl+,", run: () => useStore.setState({ settingsOpen: "audio" }) },
  { id: "audioSetup", group: "Project", title: "Audio & MIDI devices", run: () => useStore.setState({ settingsOpen: "audio" }) },
  { id: "scan", group: "Project", title: "Scan for VST plug-ins", run: () => act("plugins.scan") },

  { id: "smartMix", group: "Smart", title: "Smart Mix: gain stage, balance and master", when: hasProject,
    run: () => useStore.setState({ bottom: "smart" }) },
  { id: "vocalPop", group: "Smart", title: "Vocal chain on selected track: modern pop", when: hasProject, run: () => vocalChain(undefined, "pop") },
  { id: "vocalWarm", group: "Smart", title: "Vocal chain on selected track: warm", when: hasProject, run: () => vocalChain(undefined, "warm") },
  { id: "vocalPodcast", group: "Smart", title: "Voice chain on selected track: podcast", when: hasProject, run: () => vocalChain(undefined, "podcast") },
  { id: "countIn", group: "Transport", title: "Cycle count-in (off, 1 bar, 2 bars)", keys: "Shift+C", when: hasProject, checked: () => (S().project?.countIn ?? "none") !== "none", run: () => {
    const order = ["none", "oneBar", "twoBars"] as const;
    const cur = S().project?.countIn ?? "none";
    const next = order[(order.indexOf(cur as (typeof order)[number]) + 1) % order.length];
    act("transport.setCountIn", { mode: next });
    toast(`Count-in: ${next === "none" ? "off" : next === "oneBar" ? "1 bar" : "2 bars"}`);
  } },
];

export function runCommand(id: string) {
  const c = commands.find((x) => x.id === id);
  if (c && (!c.when || c.when())) c.run();
}

function keyName(e: KeyboardEvent) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.shiftKey && e.key.length > 1) parts.push("Shift");
  else if (e.shiftKey && /^[a-z]$/i.test(e.key)) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  let k = e.key === " " ? "Space" : e.key;
  if (k.length === 1) k = k.toUpperCase();
  if (k === "Del") k = "Delete";
  if (k === "+") k = "=";
  parts.push(k);
  return parts.join("+");
}

export function installShortcuts() {
  const map = new Map<string, Command>();
  for (const c of commands) if (c.keys) map.set(c.keys.toUpperCase(), c);
  map.set("BACKSPACE", commands.find((c) => c.id === "delete")!);
  map.set("CTRL+SHIFT+Z", commands.find((c) => c.id === "redo")!);
  map.set("CTRL+K", { id: "palette", group: "", title: "", run: () => useStore.setState((s) => ({ paletteOpen: !s.paletteOpen })) });
  map.set("SHIFT+?", commands.find((c) => c.id === "shortcuts")!);

  const handler = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
    const s = S();
    if (s.paletteOpen || s.settingsOpen || s.exportOpen) return;
    if (e.key.startsWith("Arrow") && nudgeSelection(e.key, e.shiftKey)) { e.preventDefault(); return; }
    const c = map.get(keyName(e).toUpperCase());
    if (!c || (c.when && !c.when())) return;
    e.preventDefault();
    c.run();
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
