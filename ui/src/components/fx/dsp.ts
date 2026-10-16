// Maths shared by the effect editors (and the mock engine): frequency axes, filter curves, transfer curves.

export const F_MIN = 20;
export const F_MAX = 20000;

export const freqToX = (f: number, w: number) => (Math.log(Math.max(F_MIN, f) / F_MIN) / Math.log(F_MAX / F_MIN)) * w;
export const xToFreq = (x: number, w: number) => F_MIN * Math.pow(F_MAX / F_MIN, Math.min(1, Math.max(0, x / w)));
export const dbToY = (db: number, h: number, range: number) => h / 2 - (db / range) * (h / 2);
export const yToDb = (y: number, h: number, range: number) => ((h / 2 - y) / (h / 2)) * range;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(1e-9, Math.abs(g)));

export function formatHz(f: number) {
  return f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)} kHz` : `${Math.round(f)} Hz`;
}

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (midi: number) => `${NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12]}${Math.floor(Math.round(midi) / 12) - 1}`;

/** Same bit masks as the pitch corrector: bit n set means the note n semitones above the key is in the scale. */
export const SCALE_MASKS = [0xfff, 0xab5, 0x5ad, 0x9ad, 0x295, 0x4a9, 0x4e9, 0x6ad, 0x6b5];

export const EQ_TYPES = ["Low cut", "Low shelf", "Bell", "Notch", "High shelf", "High cut"] as const;
export const EQ = { lowCut: 0, lowShelf: 1, bell: 2, notch: 3, highShelf: 4, highCut: 5 } as const;

/** RBJ cookbook biquad, normalised so a0 = 1; mirrors Biquad::design in the engine. */
export function biquad(type: number, sr: number, freq: number, gainDb: number, q: number) {
  const w0 = (2 * Math.PI * clamp(freq, 10, sr * 0.45)) / sr;
  const cs = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(0.05, q));
  const A = Math.pow(10, gainDb / 40);
  const s = 2 * Math.sqrt(A) * alpha;
  let c: number[];
  switch (type) {
    case EQ.lowCut: c = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + alpha, -2 * cs, 1 - alpha]; break;
    case EQ.highCut: c = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + alpha, -2 * cs, 1 - alpha]; break;
    case EQ.notch: c = [1, -2 * cs, 1, 1 + alpha, -2 * cs, 1 - alpha]; break;
    case EQ.lowShelf:
      c = [A * (A + 1 - (A - 1) * cs + s), 2 * A * (A - 1 - (A + 1) * cs), A * (A + 1 - (A - 1) * cs - s),
        A + 1 + (A - 1) * cs + s, -2 * (A - 1 + (A + 1) * cs), A + 1 + (A - 1) * cs - s];
      break;
    case EQ.highShelf:
      c = [A * (A + 1 + (A - 1) * cs + s), -2 * A * (A - 1 + (A + 1) * cs), A * (A + 1 + (A - 1) * cs - s),
        A + 1 - (A - 1) * cs + s, 2 * (A - 1 - (A + 1) * cs), A + 1 - (A - 1) * cs - s];
      break;
    default: c = [1 + alpha * A, -2 * cs, 1 - alpha * A, 1 + alpha / A, -2 * cs, 1 - alpha / A];
  }
  return { b0: c[0] / c[3], b1: c[1] / c[3], b2: c[2] / c[3], a1: c[4] / c[3], a2: c[5] / c[3] };
}

/** Magnitude in dB of a biquad at frequency f. */
export function biquadDb(k: ReturnType<typeof biquad>, sr: number, f: number) {
  const w = (2 * Math.PI * f) / sr;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = k.b0 + k.b1 * c1 + k.b2 * c2, ni = -(k.b1 * s1 + k.b2 * s2);
  const dr = 1 + k.a1 * c1 + k.a2 * c2, di = -(k.a1 * s1 + k.a2 * s2);
  return 10 * Math.log10(Math.max(1e-18, (nr * nr + ni * ni) / (dr * dr + di * di)));
}

export interface EqBand { on: boolean; type: number; freq: number; gain: number; q: number; stages: number }

export function bandDb(b: EqBand, sr: number, f: number) {
  if (!b.on) return 0;
  const cut = b.type === EQ.lowCut || b.type === EQ.highCut;
  if (!cut && b.type !== EQ.notch && Math.abs(b.gain) < 0.01) return 0;
  return biquadDb(biquad(b.type, sr, b.freq, b.gain, b.q), sr, f) * (cut ? b.stages : 1);
}

/** Gain change in dB for a detector level; mirrors CompressorFx::staticGainDb. */
export function compGainDb(level: number, threshold: number, ratio: number, knee: number) {
  const slope = 1 / Math.max(1, ratio) - 1;
  const over = level - threshold;
  if (knee > 0 && 2 * Math.abs(over) <= knee) return (slope * (over + knee / 2) ** 2) / (2 * knee);
  return over > 0 ? slope * over : 0;
}

/** The saturator's four curves, as in SaturatorPlugin. */
export function saturate(type: number, x: number) {
  switch (type) {
    case 1: return x >= 0 ? Math.tanh(x * 1.2) / 1.2 : (Math.tanh(x * 0.8) * 0.9) / 0.8;
    case 2: return clamp(x, -1, 1);
    case 3: return Math.sign(x) * (1 - Math.exp(-3 * Math.abs(x)));
    default: return Math.tanh(x);
  }
}

export const NOTE_VALUES = [
  { name: "Free", beats: 0 }, { name: "1/2", beats: 2 }, { name: "1/4 dotted", beats: 1.5 }, { name: "1/4", beats: 1 },
  { name: "1/4 triplet", beats: 2 / 3 }, { name: "1/8 dotted", beats: 0.75 }, { name: "1/8", beats: 0.5 },
  { name: "1/8 triplet", beats: 1 / 3 }, { name: "1/16", beats: 0.25 },
];

/** Tremolo LFO in 0..1 for phase 0..1, as in TremoloPlugin. */
export function lfo(shape: number, p: number) {
  if (shape === 1) return 1 - Math.abs(2 * p - 1);
  if (shape === 2) return clamp(0.5 + 8 * Math.sin(2 * Math.PI * p), 0, 1);
  return 0.5 + 0.5 * Math.sin(2 * Math.PI * p);
}
