import { rpc } from "./bridge";
import type { Grid } from "./store";
import type { Project } from "./types";

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function secondsPerBeat(p: Project | null) {
  return 60 / (p?.bpm || 120);
}

export function secondsPerBar(p: Project | null) {
  const [num, den] = p?.timeSig ?? [4, 4];
  return secondsPerBeat(p) * num * (4 / den);
}

export function formatBars(t: number, p: Project | null) {
  const spb = secondsPerBeat(p) * (4 / (p?.timeSig[1] ?? 4));
  const beatsPerBar = p?.timeSig[0] ?? 4;
  const totalBeats = Math.max(0, t) / spb;
  const bar = Math.floor(totalBeats / beatsPerBar) + 1;
  const beat = Math.floor(totalBeats % beatsPerBar) + 1;
  const sixteenth = Math.floor((totalBeats % 1) * 4) + 1;
  return `${bar}.${beat}.${sixteenth}`;
}

export function formatTime(t: number, ms = true) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return ms ? `${m}:${sec.toFixed(3).padStart(6, "0")}` : `${m}:${Math.floor(sec).toString().padStart(2, "0")}`;
}

export function formatDb(db: number | undefined, digits = 1) {
  if (db === undefined || db <= -99) return "-∞";
  return (db > 0 ? "+" : "") + db.toFixed(digits);
}

/** Reads a typed level such as 0, +3, -12, or -inf. */
export function parseDb(text: string): number | null {
  const raw = text.trim().toLowerCase().replace(/db\s*$/i, "").replace("−", "-").replace("∞", "inf").trim();
  if (raw === "-inf" || raw === "inf" || raw === "-infinity") return -100;
  if (!raw || raw === "+" || raw === "-") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function gridSeconds(grid: Grid, p: Project | null) {
  const beat = secondsPerBeat(p);
  switch (grid) {
    case "bar": return secondsPerBar(p);
    case "beat": return beat;
    case "1/8": return beat / 2;
    case "1/16": return beat / 4;
    default: return 0;
  }
}

export function snap(t: number, grid: Grid, p: Project | null, bypass = false) {
  const g = gridSeconds(grid, p);
  if (bypass || g <= 0) return Math.max(0, t);
  return Math.max(0, Math.round(t / g) * g);
}

/** Top of the fader. Equal decibel steps travel the same distance above and below 0. */
export const FADER_MAX_DB = 15;
const FADER_FLOOR_DB = -60;
const FADER_SPAN = FADER_MAX_DB - FADER_FLOOR_DB;
/** The last sliver of travel is the fade from the floor down to silence. */
const SILENCE = 0.04;

export function faderToDb(pos: number) {
  if (pos <= 0) return -100;
  if (pos < SILENCE) return -100 + (pos / SILENCE) * (100 + FADER_FLOOR_DB);
  return clamp(FADER_FLOOR_DB + ((pos - SILENCE) / (1 - SILENCE)) * FADER_SPAN, FADER_FLOOR_DB, FADER_MAX_DB);
}

export function dbToFader(db: number) {
  if (db <= -99) return 0;
  if (db <= FADER_FLOOR_DB) return clamp((SILENCE * (db + 100)) / (100 + FADER_FLOOR_DB), 0, SILENCE);
  return clamp(SILENCE + ((db - FADER_FLOOR_DB) / FADER_SPAN) * (1 - SILENCE), 0, 1);
}

/** The meter uses the same spacing as the fader, so a bar lines up with its number. */
export function meterPos(db: number) {
  return dbToFader(db);
}

export function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export function cx(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(" ");
}

export function shade(hex: string, alpha: number) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return `rgba(124,92,255,${alpha})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (pitch: number) => NOTE_NAMES[pitch % 12] + (Math.floor(pitch / 12) - 1);

export interface Peaks {
  binsPerSecond: number;
  length: number;
  channels: number;
  data: Int8Array;
}

const peakCache = new Map<string, Peaks>();
const peakWaiters = new Map<string, Promise<Peaks | null>>();

export function cachedPeaks(file: string) {
  return peakCache.get(file);
}

/** Loads peaks for a file; `key` lets callers re-fetch when the file changes (e.g. while recording). */
export function loadPeaks(file: string, key = file): Promise<Peaks | null> {
  const hit = peakCache.get(key);
  if (hit) return Promise.resolve(hit);
  let w = peakWaiters.get(key);
  if (!w) {
    w = rpc<{ binsPerSecond: number; length: number; channels: number; data: string }>("media.peaks", { file })
      .then((r) => {
        const bin = atob(r.data);
        const data = new Int8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = (bin.charCodeAt(i) << 24) >> 24;
        const peaks = { binsPerSecond: r.binsPerSecond, length: r.length, channels: r.channels, data };
        peakCache.set(key, peaks);
        return peaks;
      })
      .catch(() => null)
      .finally(() => peakWaiters.delete(key));
    peakWaiters.set(key, w);
  }
  return w;
}

export function invalidatePeaks(file?: string) {
  if (file) peakCache.delete(file);
  else peakCache.clear();
}

export async function fileToBase64(f: File) {
  const buf = new Uint8Array(await f.arrayBuffer());
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) s += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(s);
}

export const AUDIO_FILTER = "*.wav;*.aif;*.aiff;*.flac;*.ogg;*.mp3;*.m4a";
