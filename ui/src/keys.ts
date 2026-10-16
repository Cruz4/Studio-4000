import { rpc } from "./bridge";
import { toast, useStore } from "./store";

/** Computer keys laid out like a piano: the home row is white keys, the row above is black keys. */
export const TYPING_KEYS: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16, "'": 17,
};
export const KEY_FOR_OFFSET = Object.fromEntries(Object.entries(TYPING_KEYS).map(([k, v]) => [v, k.toUpperCase()]));

const S = () => useStore.getState();
/** Sounding note → the track it was started on, so the note-off reaches the same instrument. */
const sounding = new Map<number, string>();
const listeners = new Set<(notes: Set<number>) => void>();
let warned = false;

export function onSounding(fn: (notes: Set<number>) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const changed = () => { const notes = new Set(sounding.keys()); listeners.forEach((fn) => fn(notes)); };

/** The instrument that owns the MIDI clip open in the editor, when that panel is showing. */
function editorInstrument() {
  const s = S();
  if (s.bottom !== "editor" || !s.project) return;
  const id = s.editorClip ?? s.selectedClips[0];
  if (!id) return;
  return s.project.tracks.find((t) => t.kind === "instrument" && t.clips.some((c) => c.id === id && c.kind === "midi"));
}

/** The instrument track live notes go to: the one being edited, else the selected one, else an armed one, else the first. */
export function liveTarget() {
  const edited = editorInstrument();
  if (edited) return edited;
  const s = S();
  const inst = (s.project?.tracks ?? []).filter((t) => t.kind === "instrument");
  return inst.find((t) => t.id === s.selectedTrack) ?? inst.find((t) => t.armed) ?? inst[0];
}

export const baseNote = () => (S().octave + 1) * 12;

export function noteOn(note: number, velocity = S().velocity) {
  const target = liveTarget();
  if (!target) {
    if (!warned) toast("Add an instrument track to play notes (Track → New instrument track)", "warning");
    warned = true;
    return;
  }
  if (note < 0 || note > 127 || sounding.has(note)) return;
  sounding.set(note, target.id);
  changed();
  rpc("midi.live", { note, velocity, on: true, trackId: target.id }).catch(() => {});
}

export function noteOff(note: number) {
  const trackId = sounding.get(note);
  if (trackId === undefined) return;
  sounding.delete(note);
  changed();
  rpc("midi.live", { note, on: false, trackId }).catch(() => {});
}

export function panic() {
  [...sounding.keys()].forEach(noteOff);
  rpc("midi.panic").catch(() => {});
}

export function shiftOctave(by: number) {
  panic();
  useStore.setState((s) => ({ octave: Math.max(-1, Math.min(8, s.octave + by)) }));
}

export function shiftVelocity(by: number) {
  useStore.setState((s) => ({ velocity: Math.max(1, Math.min(127, s.velocity + by)) }));
}

export function toggleTyping(on = !S().typing) {
  if (!on) panic();
  useStore.setState({ typing: on, keysOpen: on ? true : S().keysOpen });
  if (on) toast("Musical typing on: A–L play notes, W E T Y U O P are the black keys, Z/X octave, C/V velocity");
}

/** While typing is on, note keys are taken before the regular shortcuts see them. */
export function installMusicalTyping() {
  const held = new Map<string, number>();
  const editing = (el: EventTarget | null) => {
    const e = el as HTMLElement | null;
    return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable);
  };

  const down = (e: KeyboardEvent) => {
    const s = S();
    if (!(s.typing || editorInstrument()) || !s.project || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || editing(e.target)) return;
    if (s.paletteOpen || s.settingsOpen || s.exportOpen) return;
    const k = e.key.toLowerCase();
    const consume = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (k === "z" || k === "x") { consume(); if (!e.repeat) shiftOctave(k === "z" ? -1 : 1); return; }
    if (k === "c" || k === "v") { consume(); shiftVelocity(k === "c" ? -16 : 16); return; }
    const offset = TYPING_KEYS[k];
    if (offset === undefined) return;
    consume();
    if (e.repeat || held.has(k)) return;
    const note = baseNote() + offset;
    held.set(k, note);
    noteOn(note);
  };

  const up = (e: KeyboardEvent) => {
    const note = held.get(e.key.toLowerCase());
    if (note === undefined) return;
    held.delete(e.key.toLowerCase());
    noteOff(note);
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const blur = () => { held.forEach((n) => noteOff(n)); held.clear(); };

  // Hardware keyboards play the same track when nothing is armed.
  let focused: string | undefined;
  const unsubscribe = useStore.subscribe(() => {
    const id = liveTarget()?.id;
    if (id === focused) return;
    focused = id;
    rpc("midi.focus", { trackId: id ?? "" }).catch(() => {});
  });

  window.addEventListener("keydown", down, true);
  window.addEventListener("keyup", up, true);
  window.addEventListener("blur", blur);
  return () => {
    unsubscribe();
    window.removeEventListener("keydown", down, true);
    window.removeEventListener("keyup", up, true);
    window.removeEventListener("blur", blur);
  };
}
