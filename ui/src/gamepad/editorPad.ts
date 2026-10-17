import { runCommand } from "../commands";
import { act, live } from "../store";
import type { Clip, Project } from "../types";
import { clamp, secondsPerBeat } from "../util";
import type { Bindings, DpadDir, Layer } from "./types";

export type EditorMode = "draw" | "move" | "length" | "velocity" | "quantize";

export interface EditNote { pitch: number; beat: number; len: number; vel: number }

export interface MidiPadApi {
  clip: Clip;
  project: Project;
  notes: EditNote[];
  sel: Set<number>;
  grid: number;
  noteLen: number;
  mode: { current: EditorMode };
  cursorPitch: { current: number };
  acc: { beat: number; pitch: number; len: number; vel: number };
  commit: (next: EditNote[]) => void;
  setNotes: (next: EditNote[]) => void;
  setSel: (next: Set<number>) => void;
  setNoteLen: (next: number) => void;
  scroller: { current: HTMLDivElement | null };
}

const scrubAcc = { v: 0, t: 0 };
function scrub(delta: number) {
  scrubAcc.v += delta;
  const now = performance.now();
  if (now - scrubAcc.t < 40 || Math.abs(scrubAcc.v) < 0.01) return;
  const step = scrubAcc.v;
  scrubAcc.v = 0;
  scrubAcc.t = now;
  act("transport.setPosition", { time: Math.max(0, live.tick.t + step) });
}

const audioAcc = { g: 0, p: 0, t: 0 };
const MODES: { id: EditorMode; label: string }[] = [
  { id: "draw", label: "Draw" },
  { id: "move", label: "Move" },
  { id: "length", label: "Length" },
  { id: "velocity", label: "Velocity" },
  { id: "quantize", label: "Quantize" },
];

function beatsPerBar(project: Project) {
  return project.timeSig[0] * (4 / project.timeSig[1]);
}

function replace(api: MidiPadApi, next: EditNote[]) {
  api.setNotes(next);
  api.commit(next);
}

export function midiEditorBindings(api: MidiPadApi): Bindings {
  const stepNotes = (dp: number, db: number) => {
    if (!api.sel.size || (!dp && !db)) return;
    const next = api.notes.map((note, i) => api.sel.has(i)
      ? { ...note, pitch: clamp(note.pitch + dp, 0, 127), beat: Math.max(0, note.beat + db) }
      : note);
    const first = next.find((_, i) => api.sel.has(i));
    if (first) api.cursorPitch.current = first.pitch;
    replace(api, next);
  };

  const onDpad = (dir: DpadDir, layer: Layer) => {
    const big = layer === "lt";
    const dp = (dir === "up" ? 1 : dir === "down" ? -1 : 0) * (big ? 12 : 1);
    const db = (dir === "right" ? 1 : dir === "left" ? -1 : 0) * (big ? beatsPerBar(api.project) : api.grid);
    if (api.sel.size) stepNotes(dp, db);
    else if (dp) {
      api.cursorPitch.current = clamp(api.cursorPitch.current + dp, 0, 127);
      const el = api.scroller.current;
      if (el) el.scrollTop += -dp * 14;
    } else if (db) {
      const spb = secondsPerBeat(api.project);
      act("transport.setPosition", { time: Math.max(0, live.tick.t + db * spb) });
    }
    return true;
  };

  const insert = () => {
    const spb = secondsPerBeat(api.project);
    const beat = Math.max(0, (live.tick.t - api.clip.start) / spb);
    const snapped = Math.floor(beat / api.grid) * api.grid;
    const next = [...api.notes, { pitch: api.cursorPitch.current, beat: snapped, len: api.noteLen, vel: 100 }];
    api.setSel(new Set([next.length - 1]));
    replace(api, next);
  };

  const quantize = () => {
    act("midi.quantize", { clipId: api.clip.id, grid: 0.25 });
  };

  return {
    title: `Editor · ${MODES.find((m) => m.id === api.mode.current)?.label ?? "Draw"}`,
    bare: {
      a: { label: api.mode.current === "draw" ? "Draw note" : "Draw note", run: insert },
      b: { label: "Delete notes", run: () => { if (!api.sel.size) return; const next = api.notes.filter((_, i) => !api.sel.has(i)); api.setSel(new Set()); replace(api, next); } },
      x: { label: "Quantize", run: quantize },
      y: { label: "Select all", run: () => api.setSel(new Set(api.notes.map((_, i) => i))) },
    },
    lt: {
      a: { label: "Draw note", run: insert },
      b: { label: "Delete notes", run: () => { if (!api.sel.size) return; const next = api.notes.filter((_, i) => !api.sel.has(i)); api.setSel(new Set()); replace(api, next); } },
      x: { label: "Quantize", run: quantize },
      y: { label: "Select all", run: () => api.setSel(new Set(api.notes.map((_, i) => i))) },
    },
    lbTap: { label: "Next edit", run: () => { const i = MODES.findIndex((m) => m.id === api.mode.current); api.mode.current = MODES[(i + 1) % MODES.length].id; } },
    wheel: MODES.map((m) => ({
      id: m.id,
      label: m.label,
      run: () => { api.mode.current = m.id; if (m.id === "quantize") quantize(); },
    })),
    onDpad,
    onFrame: ({ axes, dt, layer }) => {
      const el = api.scroller.current;
      const mode = api.mode.current;
      const fine = layer === "lt" ? 0.25 : 1;
      if (mode !== "move" && mode !== "velocity" && el && axes.ly) el.scrollTop += axes.ly * dt * 520;
      if (mode === "draw" && axes.lx) scrub(axes.lx * dt * 4 * secondsPerBeat(api.project) * fine);
      if (mode === "move") {
        api.acc.beat += axes.lx * dt * 6 * fine;
        api.acc.pitch += -axes.ly * dt * 8 * fine;
        const beatSteps = Math.trunc(api.acc.beat / api.grid);
        const pitchSteps = Math.trunc(api.acc.pitch);
        if (beatSteps || pitchSteps) {
          api.acc.beat -= beatSteps * api.grid;
          api.acc.pitch -= pitchSteps;
          stepNotes(pitchSteps, beatSteps * api.grid);
        }
      }
      const lengthAxis = mode === "length" ? axes.lx : axes.rx;
      const velAxis = mode === "velocity" ? -axes.ly : -axes.ry;
      if (api.sel.size && lengthAxis) {
        api.acc.len += lengthAxis * dt * 2 * fine;
        const steps = Math.trunc(api.acc.len / (api.grid / 2));
        if (steps) {
          api.acc.len -= steps * (api.grid / 2);
          const next = api.notes.map((note, i) => api.sel.has(i) ? { ...note, len: Math.max(api.grid / 2, note.len + steps * (api.grid / 2)) } : note);
          const hit = next.find((_, i) => api.sel.has(i));
          if (hit) api.setNoteLen(hit.len);
          replace(api, next);
        }
      }
      if (api.sel.size && velAxis) {
        api.acc.vel += velAxis * dt * 90 * fine;
        const steps = Math.trunc(api.acc.vel);
        if (steps) {
          api.acc.vel -= steps;
          replace(api, api.notes.map((note, i) => api.sel.has(i) ? { ...note, vel: clamp(note.vel + steps, 1, 127) } : note));
        }
      }
    },
  };
}

export function audioEditorBindings(clip: Clip): Bindings {
  return {
    title: "Audio clip",
    bare: {
      a: { label: "Normalize", run: () => act("clip.normalize", { id: clip.id, peakDb: -1 }) },
      b: { label: clip.muted ? "Unmute" : "Mute", run: () => act("clip.set", { id: clip.id, muted: !clip.muted }) },
      x: { label: clip.reversed ? "Forward" : "Reverse", run: () => act("clip.set", { id: clip.id, reversed: !clip.reversed }) },
      y: { label: "Split", run: () => runCommand("split") },
    },
    onDpad: () => false,
    onFrame: ({ axes, dt, layer }) => {
      const speed = layer === "lt" ? 0.35 : 1;
      audioAcc.g += -axes.ly * dt * 8 * speed;
      audioAcc.p += axes.rx * dt * 0.8 * speed;
      const now = performance.now();
      if (now - audioAcc.t < 50) return;
      if (Math.abs(audioAcc.g) < 0.02 && Math.abs(audioAcc.p) < 0.005) return;
      audioAcc.t = now;
      const gain = audioAcc.g;
      const pan = audioAcc.p;
      audioAcc.g = 0;
      audioAcc.p = 0;
      if (gain) act("clip.set", { id: clip.id, gainDb: clamp((clip.gainDb ?? 0) + gain, -48, 24) });
      if (pan) act("clip.set", { id: clip.id, pan: clamp(Math.round(((clip.pan ?? 0) + pan) * 100) / 100, -1, 1) });
    },
  };
}
