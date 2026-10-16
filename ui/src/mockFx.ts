// Parameter sets and simulated live readings for the built-in effects, so the editors work without the engine.
import type { Param, Plugin } from "./types";
import { EQ, NOTE_VALUES, SCALE_MASKS, bandDb, clamp, compGainDb } from "./components/fx/dsp";

type Spec = [id: string, name: string, min: number, max: number, def: number, unit?: string, centre?: number, choices?: string[]];

const offOn = ["Off", "On"];
const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const syncNames = NOTE_VALUES.map((n) => n.name);

function eqSpecs(): Spec[] {
  const types = ["Low cut", "Low shelf", "Bell", "Notch", "High shelf", "High cut"];
  const slopes = ["12 dB/oct", "24 dB/oct", "36 dB/oct", "48 dB/oct"];
  const d = [[0, 0, 40, 0.71], [1, 1, 100, 0.71], [1, 2, 250, 1], [1, 2, 700, 1], [1, 2, 2000, 1], [1, 2, 5000, 1], [1, 4, 10000, 0.71], [0, 5, 18000, 0.71]];
  return d.flatMap(([on, type, freq, q], i) => {
    const b = `b${i + 1}`, n = `Band ${i + 1}`;
    return [[`${b}on`, `${n} on`, 0, 1, on, "", 0, offOn], [`${b}type`, `${n} type`, 0, 5, type, "", 0, types], [`${b}freq`, `${n} freq`, 20, 20000, freq, "Hz", 1000],
      [`${b}gain`, `${n} gain`, -24, 24, 0, "dB"], [`${b}q`, `${n} Q`, 0.1, 18, q, "", 1], [`${b}slope`, `${n} slope`, 0, 3, 0, "", 0, slopes]] as Spec[];
  }).concat([["output", "Output", -24, 24, 0, "dB"]]);
}

const SPECS: Record<string, Spec[]> = {
  s4000eq: eqSpecs(),
  s4000comp: [["threshold", "Threshold", -60, 0, -18, "dB"], ["ratio", "Ratio", 1, 20, 4, ": 1", 4], ["knee", "Knee", 0, 24, 6, "dB"],
    ["attack", "Attack", 0.05, 200, 10, "ms", 10], ["release", "Release", 5, 2000, 120, "ms", 150], ["makeup", "Make-up", -12, 24, 0, "dB"],
    ["autoMakeup", "Auto make-up", 0, 1, 0, "", 0, offOn], ["detect", "Detection", 0, 1, 1, "", 0, ["Peak", "RMS"]], ["scHpf", "Sidechain HPF", 20, 500, 20, "Hz", 100],
    ["mix", "Mix", 0, 100, 100, "%"]],
  s4000tune: [["key", "Key", 0, 11, 0, "", 0, noteNames], ["scale", "Scale", 0, 8, 1, "", 0, ["Chromatic", "Major", "Minor", "Harmonic minor", "Major pentatonic", "Minor pentatonic", "Blues", "Dorian", "Mixolydian"]],
    ["speed", "Retune speed", 0, 400, 20, "ms", 60], ["amount", "Amount", 0, 100, 100, "%"], ["tolerance", "Tolerance", 0, 50, 0, "cents"], ["mix", "Mix", 0, 100, 100, "%"]],
  s4000gate: [["threshold", "Threshold", -80, 0, -45, "dB"], ["range", "Range", -90, 0, -60, "dB"], ["attack", "Attack", 0.05, 50, 1, "ms", 5],
    ["hold", "Hold", 0, 500, 40, "ms", 80], ["release", "Release", 5, 2000, 120, "ms", 200]],
  s4000deesser: [["frequency", "Frequency", 2000, 12000, 6000, "Hz", 5500], ["threshold", "Threshold", -60, 0, -30, "dB"], ["range", "Max reduction", 0, 24, 10, "dB"],
    ["listen", "Listen to S", 0, 1, 0, "", 0, offOn]],
  s4000transient: [["attack", "Attack", -100, 100, 0, "%"], ["sustain", "Sustain", -100, 100, 0, "%"], ["output", "Output", -12, 12, 0, "dB"]],
  s4000saturator: [["drive", "Drive", 0, 36, 6, "dB"], ["type", "Character", 0, 3, 0, "", 0, ["Tape", "Tube", "Hard clip", "Fuzz"]], ["tone", "Tone", -100, 100, 0, "%"],
    ["output", "Output", -24, 12, 0, "dB"], ["mix", "Mix", 0, 100, 100, "%"]],
  s4000crusher: [["bits", "Bits", 1, 16, 8], ["downsample", "Downsample", 1, 40, 4, "x", 8], ["mix", "Mix", 0, 100, 100, "%"], ["output", "Output", -24, 12, 0, "dB"]],
  s4000delay: [["sync", "Sync", 0, 8, 6, "", 0, syncNames], ["time", "Time (free)", 1, 2000, 350, "ms", 300], ["feedback", "Feedback", 0, 95, 35, "%"],
    ["pingPong", "Ping-pong", 0, 1, 1, "", 0, offOn], ["lowCut", "Low cut", 20, 2000, 150, "Hz", 300], ["highCut", "High cut", 1000, 20000, 7000, "Hz", 5000], ["mix", "Mix", 0, 100, 25, "%"]],
  s4000doubler: [["detune", "Detune", 0, 40, 12, "cents"], ["delay", "Delay", 5, 60, 18, "ms"], ["width", "Width", 0, 100, 100, "%"], ["mix", "Mix", 0, 100, 50, "%"]],
  s4000width: [["width", "Width", 0, 200, 120, "%"], ["bassMono", "Mono below", 0, 500, 120, "Hz"], ["output", "Output", -12, 12, 0, "dB"]],
  s4000tremolo: [["mode", "Mode", 0, 1, 0, "", 0, ["Tremolo", "Auto-pan"]], ["rate", "Rate", 0.1, 20, 4, "Hz", 3], ["sync", "Sync", 0, 8, 0, "", 0, syncNames],
    ["depth", "Depth", 0, 100, 60, "%"], ["shape", "Shape", 0, 2, 0, "", 0, ["Sine", "Triangle", "Square"]]],
  s4000limiter: [["inputGain", "Input Gain", 0, 24, 0, "dB"], ["ceiling", "Ceiling", -12, 0, -1, "dB"], ["release", "Release", 10, 1000, 100, "ms"]],
  reverb: [["room size", "Room Size", 0, 1, 0.3], ["damping", "Damping", 0, 1, 0.5], ["wet level", "Wet Level", 0, 1, 0.33], ["dry level", "Dry Level", 0, 1, 0.4],
    ["width", "Width", 0, 1, 1], ["mode", "Freeze", 0, 1, 0]],
  "4bandEq": [["Low-pass freq", "Low-shelf freq", 20, 20000, 80, "Hz", 1000], ["Low-pass gain", "Low-shelf gain", -20, 20, 0, "dB"], ["Low-pass Q", "Low-shelf Q", 0.1, 4, 0.5],
    ["Mid freq 1", "Mid freq 1", 20, 20000, 500, "Hz", 1000], ["Mid gain 1", "Mid gain 1", -20, 20, 0, "dB"], ["Mid Q 1", "Mid Q 1", 0.1, 4, 0.5],
    ["Mid freq 2", "Mid freq 2", 20, 20000, 3000, "Hz", 1000], ["Mid gain 2", "Mid gain 2", -20, 20, 0, "dB"], ["Mid Q 2", "Mid Q 2", 0.1, 4, 0.5],
    ["High-pass freq", "High-shelf freq", 20, 20000, 12000, "Hz", 1000], ["High-pass gain", "High-shelf gain", -20, 20, 0, "dB"], ["High-pass Q", "High-shelf Q", 0.1, 4, 0.5]],
  compressor: [["threshold", "Threshold", 0.01, 1, 0.4], ["ratio", "Ratio", 0.05, 1, 0.33], ["attack", "Attack", 0.3, 200, 30, "ms"], ["release", "Release", 10, 300, 100, "ms"],
    ["output gain", "Output gain", -10, 24, 0, "dB"], ["input gain", "Sidechain gain", -24, 24, 0, "dB"]],
};

interface Meta { spec: Spec; skew: number }
const meta = new Map<Param, Meta>();

const skewFor = (min: number, max: number, centre?: number) =>
  centre && centre > min && centre < max ? Math.log(0.5) / Math.log((centre - min) / (max - min)) : 1;

function describe(spec: Spec, value: number, skew: number): Param {
  const [id, name, min, max, def, unit = "", , choices] = spec;
  const stepped = !!choices;
  const v = clamp(stepped ? Math.round(value) : value, min, max);
  const norm = Math.pow((v - min) / (max - min), skew);
  const span = max - min;
  const text = stepped ? choices![Math.round(v - min)] ?? String(v) : `${v.toFixed(span >= 100 ? 0 : span >= 10 ? 1 : 2)}${unit ? ` ${unit}` : ""}`;
  const p: Param = { id, name, value: v, norm, text, min, max, automated: false, def };
  if (stepped) p.options = choices!.map((label, i) => ({ value: min + i, norm: Math.pow(i / span, skew), label }));
  meta.set(p, { spec, skew });
  return p;
}

export function paramsFor(type: string): Param[] | null {
  const specs = SPECS[type];
  return specs ? specs.map((s) => describe(s, s[4], skewFor(s[2], s[3], s[6]))) : null;
}

export function updateParam(list: Param[], pid: string, how: { value?: number; norm?: number }): Param | null {
  const i = list.findIndex((p) => p.id === pid);
  if (i < 0) return null;
  const m = meta.get(list[i]);
  if (!m) return null;
  const [, , min, max] = m.spec;
  const value = how.norm !== undefined ? min + Math.pow(clamp(how.norm, 0, 1), 1 / m.skew) * (max - min) : how.value ?? list[i].value;
  list[i] = describe(m.spec, value, m.skew);
  return list[i];
}

//==============================================================================
const val = (pl: Plugin, id: string, fallback = 0) => pl.params.find((p) => p.id === id)?.value ?? fallback;
let noise = 1;
const rnd = () => ((noise = (noise * 16807) % 2147483647) / 2147483647);

function spectrum(t: number) {
  return Array.from({ length: 160 }, (_, i) => {
    const f = 20 * Math.pow(1000, (i + 0.5) / 160);
    const oct = Math.log2(f / 1000);
    const kick = 12 * Math.exp(-(((Math.log2(f / 55)) / 0.5) ** 2)) * (0.6 + 0.4 * Math.abs(Math.sin(t * 4.2)));
    const voice = 8 * Math.exp(-(((Math.log2(f / 900)) / 1.6) ** 2)) * (0.7 + 0.3 * Math.sin(t * 2.3 + i * 0.05));
    const air = f > 14000 ? -((f - 14000) / 1000) * 3 : 0;
    return -42 - 4.5 * oct + kick + voice + air + (rnd() - 0.5) * 7;
  });
}

function silentTelemetry(pl: Plugin, opts: { spectrum?: boolean; scope?: boolean }) {
  const out: Record<string, unknown> = { ...mockTelemetry(pl, opts), inDb: -180, outDb: -180 };
  const floor = Array(160).fill(-120), zeros = Array(512).fill(0);
  if (opts.spectrum) Object.assign(out, { spectrumIn: floor, spectrumOut: floor });
  if (opts.scope) Object.assign(out, { scopeL: zeros, scopeR: zeros, correlation: 1 });
  const quiet: Record<string, unknown> = {
    levelDb: -180, grDb: 0, open: false, sibilanceDb: -180, reductionDb: 0, boostDb: 0, cutDb: 0, detectedNote: 0, targetNote: 0, correctionCents: 0,
  };
  for (const k of Object.keys(quiet)) if (k in out) out[k] = quiet[k];
  if (pl.type === "s4000gate") out.gainDb = val(pl, "range", -60);
  return out;
}

/** Fake readings for the preview. Like the engine, there is no signal unless something is playing or the input is live. */
export function mockTelemetry(pl: Plugin, opts: { spectrum?: boolean; scope?: boolean }, signal = true) {
  if (!signal) return silentTelemetry(pl, opts);
  const t = performance.now() / 1000;
  const beat = Math.abs(Math.sin(t * 3.1)) ** 3;
  const level = -34 + 26 * beat + (rnd() - 0.5) * 2;
  const out: Record<string, unknown> = { sampleRate: 48000, inDb: level + 4, outDb: level + 2 };

  if (opts.spectrum) {
    const pre = spectrum(t);
    let post = pre;
    if (pl.type === "s4000eq") {
      const bands = Array.from({ length: 8 }, (_, i) => ({
        on: val(pl, `b${i + 1}on`) >= 0.5, type: Math.round(val(pl, `b${i + 1}type`, EQ.bell)), freq: val(pl, `b${i + 1}freq`, 1000),
        gain: val(pl, `b${i + 1}gain`), q: val(pl, `b${i + 1}q`, 1), stages: Math.round(val(pl, `b${i + 1}slope`)) + 1,
      }));
      post = pre.map((db, i) => {
        const f = 20 * Math.pow(1000, (i + 0.5) / 160);
        return db + bands.reduce((s, b) => s + bandDb(b, 48000, f), 0) + val(pl, "output");
      });
    } else if (pl.type === "s4000saturator") {
      post = pre.map((db, i) => db + (i > 60 ? val(pl, "drive", 6) * 0.4 : 0));
    }
    out.spectrumIn = pre.map((v) => Math.round(v * 10) / 10);
    out.spectrumOut = post.map((v) => Math.round(v * 10) / 10);
  }

  if (opts.scope) {
    const width = pl.type === "s4000width" ? val(pl, "width", 120) / 100 : 0.8;
    const L: number[] = [], R: number[] = [];
    for (let i = 0; i < 512; i++) {
      const m = 0.45 * Math.sin(i * 0.05 + t * 7) + 0.2 * Math.sin(i * 0.13 + t);
      const s = width * (0.18 * Math.sin(i * 0.031 + t * 3) + 0.08 * (rnd() - 0.5));
      L.push(m + s);
      R.push(m - s);
    }
    out.scopeL = L;
    out.scopeR = R;
    out.correlation = Math.round(clamp(1 - width * 0.45, -1, 1) * 100) / 100;
  }

  switch (pl.type) {
    case "s4000comp": {
      const thr = val(pl, "threshold", -18), ratio = val(pl, "ratio", 4), knee = val(pl, "knee", 6);
      out.levelDb = level;
      out.grDb = Math.round(-compGainDb(level, thr, ratio, knee) * 10) / 10;
      break;
    }
    case "s4000gate": {
      const thr = val(pl, "threshold", -45);
      out.levelDb = level - 14;
      out.open = level - 14 > thr;
      out.gainDb = out.open ? 0 : val(pl, "range", -60);
      break;
    }
    case "s4000deesser": {
      const sib = -46 + 30 * Math.max(0, Math.sin(t * 1.7)) ** 8 + (rnd() - 0.5) * 3;
      out.sibilanceDb = sib;
      out.reductionDb = Math.round(clamp(sib - val(pl, "threshold", -30), 0, val(pl, "range", 10)) * 10) / 10;
      break;
    }
    case "s4000transient":
      out.boostDb = Math.max(0, beat * (val(pl, "attack") / 100) * 10);
      out.cutDb = Math.max(0, (1 - beat) * (-val(pl, "sustain") / 100) * 8);
      break;
    case "s4000tune": {
      const key = Math.round(val(pl, "key")), mask = SCALE_MASKS[Math.round(val(pl, "scale", 1))] ?? 0xfff;
      const melody = [0, 2, 4, 5, 7, 5, 4, 2];
      const step = Math.floor(t / 0.9) % melody.length;
      const voiced = t % 0.9 < 0.78;
      let target = 60 + key + melody[step];
      while (!(mask & (1 << ((((target - key) % 12) + 12) % 12)))) target++;
      const detected = target + 0.35 * Math.sin(t * 5.5) + 0.18 * Math.sin(t * 1.3 + step);
      out.detectedNote = voiced ? detected : 0;
      out.targetNote = voiced ? target : 0;
      out.correctionCents = voiced ? (target - detected) * 100 * (val(pl, "amount", 100) / 100) * (val(pl, "speed", 20) > 150 ? 0.5 : 0.95) : 0;
      out.scaleMask = mask;
      break;
    }
    case "s4000tremolo": {
      const sync = Math.round(val(pl, "sync"));
      const hz = sync > 0 ? 2 / NOTE_VALUES[sync].beats : val(pl, "rate", 4);
      out.rateHz = hz;
      out.phase = (t * hz) % 1;
      break;
    }
    case "s4000delay": {
      const sync = Math.round(val(pl, "sync", 6));
      out.delayMs = sync > 0 ? NOTE_VALUES[sync].beats * 500 : val(pl, "time", 350);
      out.bpm = 120;
      break;
    }
    case "s4000limiter":
      out.grDb = Math.round(Math.max(0, beat * (val(pl, "inputGain") + 3) - 1) * 10) / 10;
      break;
  }
  return out;
}
