// Building blocks for the effect editors: live parameters, telemetry polling, knobs, switches, meters and canvases.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { rpc } from "../../bridge";
import { toast, useStore } from "../../store";
import type { Param } from "../../types";
import { cx } from "../../util";
import { useThemeName } from "../../theme";
import { clamp } from "./dsp";

export interface Telemetry {
  sampleRate?: number;
  inDb?: number;
  outDb?: number;
  spectrumIn?: number[];
  spectrumOut?: number[];
  scopeL?: number[];
  scopeR?: number[];
  correlation?: number;
  [key: string]: unknown;
}

export interface Fx {
  id: string;
  params: Param[];
  ready: boolean;
  get: (pid: string) => Param | undefined;
  /** Real value of a parameter, or the fallback when it does not exist. */
  v: (pid: string, fallback?: number) => number;
  /** Index of the selected option for a stepped parameter. */
  c: (pid: string) => number;
  set: (pid: string, value: number) => void;
  setMany: (values: Record<string, number>) => void;
  setNorm: (pid: string, norm: number) => void;
  reset: (pid: string) => void;
  resetAll: () => void;
}

const toNorm = (p: Param, value: number) => {
  if (p.max === p.min) return 0;
  // Linear guess until the engine replies with the exact (possibly skewed) position.
  return clamp((value - p.min) / (p.max - p.min), 0, 1);
};

/** Lets the game controller turn, reset, or toggle a control without knowing the parameter. */
function usePadTarget<T extends HTMLElement>(kind: string, handlers: { adjust?: (delta: number) => void; reset?: () => void; activate?: () => void }) {
  const saved = useRef(handlers);
  saved.current = handlers;
  const cleanup = useRef<(() => void) | null>(null);
  const ref = useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const adjust = (e: Event) => saved.current.adjust?.((e as CustomEvent<number>).detail);
    const reset = () => saved.current.reset?.();
    const activate = () => saved.current.activate?.();
    el.addEventListener("pad-adjust", adjust);
    el.addEventListener("pad-reset", reset);
    el.addEventListener("pad-activate", activate);
    cleanup.current = () => {
      el.removeEventListener("pad-adjust", adjust);
      el.removeEventListener("pad-reset", reset);
      el.removeEventListener("pad-activate", activate);
    };
  }, []);
  return { ref, kind };
}

/** Live parameter state for one plug-in. Writes are coalesced to one in-flight call per kind so drags stay smooth. */
export function useFx(id: string, seed: Param[] = []): Fx {
  const [params, setParams] = useState<Param[]>(Array.isArray(seed) ? seed : []);
  const [ready, setReady] = useState(false);
  const pendingValues = useRef<Record<string, number>>({});
  const pendingNorm = useRef<Record<string, number>>({});
  const busy = useRef(false);
  const lastWrite = useRef(0);
  const project = useStore((s) => s.project);

  const load = useCallback(() => {
    rpc<Param[] | null>("plugin.params", { id })
      .then((r) => { if (Array.isArray(r)) setParams(r); setReady(true); })
      .catch(() => setReady(true));
  }, [id]);

  useEffect(() => { setParams(Array.isArray(seed) ? seed : []); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Undo, automation or the assistant can change values too; resync when the project changes and we are not mid-drag.
  useEffect(() => {
    if (Date.now() - lastWrite.current < 600) return;
    const t = setTimeout(load, 120);
    return () => clearTimeout(t);
  }, [project, load]);

  const merge = (updated: Param[]) => {
    const byId = new Map(updated.filter(Boolean).map((p) => [p.id, p]));
    setParams((ps) => ps.map((p) => {
      const u = byId.get(p.id);
      if (!u) return p;
      // Keep newer local values the user is still dragging.
      if (p.id in pendingValues.current || p.id in pendingNorm.current) return { ...u, value: p.value, norm: p.norm };
      return u;
    }));
  };

  const flush = useCallback(async () => {
    if (busy.current) return;
    const values = pendingValues.current;
    const norms = pendingNorm.current;
    if (!Object.keys(values).length && !Object.keys(norms).length) return;
    pendingValues.current = {};
    pendingNorm.current = {};
    busy.current = true;
    try {
      if (Object.keys(values).length) {
        const r = await rpc<Param[]>("plugin.setParams", { id, values });
        if (Array.isArray(r)) merge(r);
      }
      for (const [paramId, norm] of Object.entries(norms)) {
        const r = await rpc<Param>("plugin.setParam", { id, paramId, norm });
        if (r) merge([r]);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      busy.current = false;
      if (Object.keys(pendingValues.current).length || Object.keys(pendingNorm.current).length) requestAnimationFrame(() => flush());
    }
  }, [id]);

  const byId = useMemo(() => new Map(params.map((p) => [p.id, p])), [params]);

  const setMany = useCallback((values: Record<string, number>) => {
    lastWrite.current = Date.now();
    setParams((ps) => ps.map((p) => {
      if (!(p.id in values)) return p;
      const value = clamp(values[p.id], p.min, p.max);
      return { ...p, value, norm: toNorm(p, value) };
    }));
    Object.assign(pendingValues.current, values);
    requestAnimationFrame(() => flush());
  }, [flush]);

  const set = useCallback((pid: string, value: number) => setMany({ [pid]: value }), [setMany]);

  const setNorm = useCallback((pid: string, norm: number) => {
    lastWrite.current = Date.now();
    norm = clamp(norm, 0, 1);
    setParams((ps) => ps.map((p) => (p.id === pid ? { ...p, norm, value: p.min + (p.max - p.min) * norm } : p)));
    pendingNorm.current[pid] = norm;
    requestAnimationFrame(() => flush());
  }, [flush]);

  return {
    id, params, ready,
    get: (pid) => byId.get(pid),
    v: (pid, fallback = 0) => { const p = byId.get(pid); return p && Number.isFinite(p.value) ? p.value : fallback; },
    c: (pid) => {
      const p = byId.get(pid);
      if (!p) return 0;
      if (!p.options?.length) return Math.round(p.value);
      let best = 0;
      p.options.forEach((o, i) => { if (Math.abs(o.value - p.value) < Math.abs(p.options![best].value - p.value)) best = i; });
      return best;
    },
    set, setMany, setNorm,
    reset: (pid) => { const p = byId.get(pid); if (p?.def !== undefined) set(pid, p.def); },
    resetAll: () => {
      const values: Record<string, number> = {};
      for (const p of params) if (p.def !== undefined) values[p.id] = p.def;
      if (Object.keys(values).length) setMany(values);
    },
  };
}

/** Polls the engine for live readings while the editor is open. */
export function useTelemetry(id: string, opts: { spectrum?: boolean; scope?: boolean } = {}, hz = 20): Telemetry {
  const [t, setT] = useState<Telemetry>({});
  const { spectrum = false, scope = false } = opts;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!alive) return;
      if (!document.hidden) {
        const r = await rpc<Telemetry>("plugin.telemetry", { id, spectrum, scope }).catch(() => null);
        if (alive && r) setT(r);
      }
      if (alive) timer = setTimeout(tick, 1000 / hz);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [id, spectrum, scope, hz]);

  return t;
}

/** Keeps a rolling history of a reading, sampled each time the telemetry updates. */
export function useHistory(t: Telemetry, pick: (t: Telemetry) => number | undefined, length = 160, fill = -90) {
  const ref = useRef<number[]>(Array(length).fill(fill));
  const last = useRef<Telemetry | null>(null);
  if (t !== last.current) {
    last.current = t;
    const v = pick(t);
    if (v !== undefined && Number.isFinite(v)) ref.current = [...ref.current.slice(1), v];
  }
  return ref.current;
}

/**
 * Live analyser while the transport is playing. When it is stopped, the last real
 * spectrum is kept and marked as a ghost. Silence never becomes a new frame.
 */
export function useAnalyserFrame(values: number[] | undefined): { points: number[]; ghost: boolean } {
  const playing = useStore((s) => s.transport.playing);
  const held = useRef<number[]>([]);
  const live = useSmoothed(playing ? values : undefined);
  if (playing && live.length) held.current = live.slice();
  if (playing) return { points: live, ghost: false };
  return { points: held.current, ghost: held.current.length > 0 };
}

/** Peak-falling smoothing for spectra so the analyser reads like a hardware one. */
export function useSmoothed(values: number[] | undefined, fall = 1.5) {
  const ref = useRef<number[]>([]);
  const audible = values?.some((v) => v > -80);
  if (!values?.length || !audible) {
    ref.current = [];
    return ref.current;
  }
  const prev = ref.current.length === values.length ? ref.current : values;
  ref.current = values.map((v, i) => (v > prev[i] ? v * 0.6 + prev[i] * 0.4 : Math.max(v, prev[i] - fall)));
  return ref.current;
}

//==============================================================================
/** A canvas sized to its box at device resolution; draw runs whenever deps change. */
export function useCanvas(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useThemeName();
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    if (el.width !== Math.round(size.w * dpr) || el.height !== Math.round(size.h * dpr)) {
      el.width = Math.round(size.w * dpr);
      el.height = Math.round(size.h * dpr);
    }
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    draw(ctx, size.w, size.h);
  }, [size, theme, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ref, size };
}

const lightPaper = () => document.documentElement.dataset.theme === "light";

export const COLORS = {
  violet: "#7c5cff", violet2: "#a08bff", cyan: "#00d1ff", green: "#21e6a5", amber: "#ffc857", red: "#ff4d6d",
  pink: "#ff6bd5", orange: "#ff8a4c",
  get grid() { return lightPaper() ? "rgba(8,10,14,0.34)" : "rgba(255,255,255,0.06)"; },
  get grid2() { return lightPaper() ? "rgba(8,10,14,0.58)" : "rgba(255,255,255,0.12)"; },
  get label() { return lightPaper() ? "rgba(14,17,22,0.9)" : "rgba(154,161,181,0.8)"; },
  get paper() { return lightPaper() ? "#5c646e" : "#090b14"; },
  get paperDeep() { return lightPaper() ? "#4e555e" : "#07080e"; },
  get ink() { return lightPaper() ? "#0e1116" : "#ffffff"; },
  get inkSoft() { return lightPaper() ? "rgba(14,17,22,0.88)" : "rgba(232,234,242,0.85)"; },
  get trace() { return lightPaper() ? "#3d2a99" : "#f0ecff"; },
  get off() { return lightPaper() ? "#4a515b" : "#1a1e2c"; },
  get laneBlack() { return lightPaper() ? "#2a3038" : "#151827"; },
  get laneWhite() { return lightPaper() ? "#d5dae1" : "#232838"; },
  get noteOn() { return lightPaper() ? "#0e1116" : "#cfd3e6"; },
  get noteOff() { return lightPaper() ? "#5c6574" : "#4b5168"; },
  get laneOff() { return lightPaper() ? "rgba(8,10,14,0.22)" : "rgba(0,0,0,0.25)"; },
};
export const BAND_COLORS = [COLORS.red, COLORS.orange, COLORS.amber, COLORS.green, COLORS.cyan, "#4d8bff", COLORS.violet2, COLORS.pink];

export function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

//==============================================================================
interface KnobProps {
  fx: Fx;
  pid: string;
  label?: string;
  size?: number;
  color?: string;
  bipolar?: boolean;
  disabled?: boolean;
  format?: (p: Param) => string;
}

/** A rotary control bound to a parameter: drag up/down (Shift for fine), wheel, double-click to reset, click the value to type it. */
export function Knob({ fx, pid, label, size = 46, color = COLORS.violet2, bipolar, disabled, format }: KnobProps) {
  const p = fx.get(pid);
  const drag = useRef<{ y: number; norm: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const pad = usePadTarget<HTMLDivElement>("knob", {
    adjust: (delta) => { const cur = fx.get(pid); if (cur && !disabled) fx.setNorm(pid, (Number.isFinite(cur.norm) ? cur.norm : 0) + delta); },
    reset: () => { if (!disabled) fx.reset(pid); },
  });
  if (!p) return null;
  const norm = Number.isFinite(p.norm) ? clamp(p.norm, 0, 1) : 0;
  const isBipolar = bipolar ?? (p.min < 0 && p.max > 0);
  const start = -135, sweep = 270;
  const zeroNorm = isBipolar ? clamp((0 - p.min) / (p.max - p.min), 0, 1) : 0;
  const a0 = start + sweep * (isBipolar ? Math.min(zeroNorm, norm) : 0);
  const a1 = start + sweep * (isBipolar ? Math.max(zeroNorm, norm) : norm);
  const r = size / 2 - 4, cxy = size / 2;
  const pt = (deg: number, rr = r) => [cxy + rr * Math.sin((deg * Math.PI) / 180), cxy - rr * Math.cos((deg * Math.PI) / 180)];
  const arc = (from: number, to: number) => {
    const [x0, y0] = pt(from), [x1, y1] = pt(to);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const [hx, hy] = pt(start + sweep * norm, r - 7);
  const text = format ? format(p) : p.text;

  return (
    <div ref={pad.ref} data-pad={pad.kind} className={cx("fx-knob", disabled && "disabled")} title={`${p.name}: ${p.text}\nDrag, scroll, or double-click to reset`}>
      <svg width={size} height={size}
        onPointerDown={(e) => { if (disabled) return; (e.target as Element).setPointerCapture(e.pointerId); drag.current = { y: e.clientY, norm }; }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const scale = e.shiftKey ? 800 : 200;
          fx.setNorm(pid, drag.current.norm + (drag.current.y - e.clientY) / scale);
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => fx.reset(pid)}
        onWheel={(e) => { if (!disabled) fx.setNorm(pid, norm - Math.sign(e.deltaY) * (e.shiftKey ? 0.002 : 0.02)); }}>
        <circle cx={cxy} cy={cxy} r={r - 3} className="fx-knob-body" />
        <path d={arc(start, start + sweep)} className="fx-knob-track" />
        {a1 - a0 > 0.5 && <path d={arc(a0, a1)} stroke={color} className="fx-knob-value" style={{ filter: `drop-shadow(0 0 4px ${rgba(color, 0.6)})` }} />}
        <line x1={cxy} y1={cxy} x2={hx} y2={hy} className="fx-knob-pointer" />
      </svg>
      {editing ? (
        <input className="fx-knob-edit" autoFocus defaultValue={String(+p.value.toFixed(2))}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { const v = parseFloat((e.target as HTMLInputElement).value); if (Number.isFinite(v)) fx.set(pid, v); setEditing(false); }
            if (e.key === "Escape") setEditing(false);
            e.stopPropagation();
          }} />
      ) : (
        <span className="fx-knob-value-text" onClick={() => !disabled && setEditing(true)}>{text}</span>
      )}
      <span className="fx-knob-label">{label ?? p.name}</span>
    </div>
  );
}

/** Segmented buttons for a stepped parameter. */
export function Seg({ fx, pid, label, labels, small }: { fx: Fx; pid: string; label?: string; labels?: string[]; small?: boolean }) {
  const p = fx.get(pid);
  const options = p?.options?.length ? p.options : [];
  const current = p ? fx.c(pid) : 0;
  const pad = usePadTarget<HTMLDivElement>("step", {
    activate: () => { if (!p || !options.length) return; fx.set(pid, options[(current + 1) % options.length].value); },
  });
  if (!p) return null;
  return (
    <div ref={pad.ref} data-pad={pad.kind} className="fx-seg-wrap">
      {label && <span className="fx-label">{label}</span>}
      <div className={cx("fx-seg", small && "small")}>
        {options.map((o, i) => (
          <button key={i} className={cx(i === current && "on")} onClick={() => fx.set(pid, o.value)} title={o.label}>{labels?.[i] ?? o.label}</button>
        ))}
      </div>
    </div>
  );
}

/** An on/off switch for a two-step parameter. */
export function Toggle({ fx, pid, label }: { fx: Fx; pid: string; label?: string }) {
  const p = fx.get(pid);
  const on = p ? fx.c(pid) === 1 : false;
  const pad = usePadTarget<HTMLButtonElement>("switch", { activate: () => { if (p) fx.set(pid, on ? p.min : p.max); } });
  if (!p) return null;
  return (
    <button ref={pad.ref} data-pad={pad.kind} className={cx("fx-toggle", on && "on")} onClick={() => fx.set(pid, on ? p.min : p.max)}>
      <span className="led" /> {label ?? p.name}
    </button>
  );
}

/** A dropdown for a stepped parameter with many options. */
export function Pick({ fx, pid, label }: { fx: Fx; pid: string; label?: string }) {
  const p = fx.get(pid);
  const pad = usePadTarget<HTMLLabelElement>("step", {
    activate: () => { if (p?.options?.length) fx.set(pid, p.options[(fx.c(pid) + 1) % p.options.length].value); },
  });
  if (!p?.options?.length) return null;
  return (
    <label ref={pad.ref} data-pad={pad.kind} className="fx-pick">
      {label !== "" && <span className="fx-label">{label ?? p.name}</span>}
      <select className="input sm" value={fx.c(pid)} onChange={(e) => fx.set(pid, p.options![+e.target.value].value)}>
        {p.options.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** A vertical level meter in dBFS, or a gain-reduction meter that fills downwards. */
export function Meter({ db, label, gr, min = -60, height = 120, color }: { db?: number; label: string; gr?: boolean; min?: number; height?: number; color?: string }) {
  const hold = useRef({ v: -999, t: 0 });
  const value = db ?? (gr ? 0 : min);
  const frac = gr ? clamp(value / 24, 0, 1) : clamp((value - min) / -min, 0, 1);
  const now = Date.now();
  if (value > hold.current.v || now - hold.current.t > 1200) hold.current = { v: value, t: now };
  const holdFrac = gr ? clamp(hold.current.v / 24, 0, 1) : clamp((hold.current.v - min) / -min, 0, 1);
  return (
    <div className="fx-meter" style={{ height }}>
      <div className="fx-meter-bar">
        <div className={cx("fill", gr && "gr")} style={gr ? { height: `${frac * 100}%`, top: 0 } : { height: `${frac * 100}%`, bottom: 0, background: color }} />
        <div className="hold" style={gr ? { top: `${holdFrac * 100}%` } : { bottom: `${holdFrac * 100}%` }} />
      </div>
      <span className="fx-meter-val">{gr ? (value > 0.05 ? `-${value.toFixed(1)}` : "0.0") : value <= min ? "-∞" : value.toFixed(1)}</span>
      <span className="fx-label">{label}</span>
    </div>
  );
}

export function Section({ title, children, className, right }: { title?: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <div className={cx("fx-section", className)}>
      {(title || right) && <div className="fx-section-head"><span>{title}</span>{right}</div>}
      {children}
    </div>
  );
}

/** Quick-start settings for an effect. A dropdown keeps a long list inside the window. */
export function Presets({ fx, presets }: { fx: Fx; presets: { name: string; values: Record<string, number> }[] }) {
  return (
    <label className="fx-presets">
      <span className="fx-label">Presets</span>
      <select className="input sm" value="" title="Apply a starting point. Your current settings are replaced."
        onChange={(e) => {
          const preset = presets.find((p) => p.name === e.target.value);
          if (preset) fx.setMany(preset.values);
        }}>
        <option value="">Choose a preset…</option>
        {presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
      </select>
    </label>
  );
}

//==============================================================================
/** Background grid for frequency displays: decades, labelled octaves and dB lines. */
export function drawFreqGrid(ctx: CanvasRenderingContext2D, w: number, h: number, dbLines: { db: number; y: number }[], freqToXFn: (f: number) => number) {
  ctx.lineWidth = 1;
  ctx.font = "10px Inter, Segoe UI, sans-serif";
  for (const f of [20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 20000]) {
    const x = Math.round(freqToXFn(f)) + 0.5;
    const major = [100, 1000, 10000].includes(f);
    ctx.strokeStyle = major ? COLORS.grid2 : COLORS.grid;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  ctx.fillStyle = COLORS.label;
  for (const [f, l] of [[50, "50"], [100, "100"], [200, "200"], [500, "500"], [1000, "1k"], [2000, "2k"], [5000, "5k"], [10000, "10k"]] as [number, string][]) {
    ctx.fillText(l, freqToXFn(f) + 3, h - 5);
  }
  for (const { db, y } of dbLines) {
    ctx.strokeStyle = db === 0 ? COLORS.grid2 : COLORS.grid;
    ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); ctx.stroke();
    ctx.fillText(`${db > 0 ? "+" : ""}${db}`, w - 22, y - 3);
  }
}

/** Draws an analyser trace from log-spaced dB points (20 Hz .. 20 kHz). */
export function drawSpectrum(ctx: CanvasRenderingContext2D, w: number, h: number, points: number[], opts: { color: string; fill?: boolean; floor?: number; ceil?: number; width?: number }) {
  if (!points.length || points.every((v) => v <= -80)) return;
  const floor = opts.floor ?? -96, ceil = opts.ceil ?? 0;
  const y = (db: number) => h - ((clamp(db, floor, ceil) - floor) / (ceil - floor)) * h;
  ctx.beginPath();
  points.forEach((db, i) => {
    const x = ((i + 0.5) / points.length) * w;
    // A gentle tilt (+4.5 dB/oct around 1 kHz) makes typical music read flat, like most analysers.
    const hz = Math.max(20, 20 * Math.pow(1000, (i + 0.5) / points.length));
    const tilted = db <= -80 ? db : db + 4.5 * Math.log2(hz / 1000);
    if (i === 0) ctx.moveTo(0, y(tilted));
    ctx.lineTo(x, y(tilted));
  });
  ctx.lineTo(w, h);
  if (opts.fill) {
    ctx.lineTo(0, h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(opts.color, 0.35));
    g.addColorStop(1, rgba(opts.color, 0.02));
    ctx.fillStyle = g;
    ctx.fill();
  } else {
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = opts.width ?? 1.2;
    ctx.stroke();
  }
}
