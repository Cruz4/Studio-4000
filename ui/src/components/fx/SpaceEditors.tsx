// Editors for time, space and movement: stereo delay, doubler, stereo width, tremolo / auto-pan, chorus and reverb.
import { useEffect, useRef } from "react";
import { cx } from "../../util";
import { COLORS, Knob, Meter, Pick, Presets, Section, Seg, Toggle, rgba, useCanvas, useTelemetry } from "./core";
import type { Fx } from "./core";
import { NOTE_VALUES, clamp, freqToX, lfo } from "./dsp";
import { CHORUS_PRESETS, DELAY_PRESETS, DOUBLER_PRESETS, REVERB_PRESETS, TREMOLO_PRESETS, WIDTH_PRESETS } from "./presets";

export function DelayEditor({ fx, pluginId }: { fx: Fx; pluginId: string }) {
  const t = useTelemetry(pluginId, {}, 10);
  const sync = fx.c("sync");
  const bpm = (t.bpm as number | undefined) ?? 120;
  const ms = (t.delayMs as number | undefined) ?? (sync > 0 ? (NOTE_VALUES[sync].beats * 60000) / bpm : fx.v("time", 350));
  const fb = fx.v("feedback", 35) / 100, ping = fx.c("pingPong") === 1, mix = fx.v("mix", 25) / 100;
  const lowCut = fx.v("lowCut", 150), highCut = fx.v("highCut", 7000);

  const taps = useCanvas((ctx, w, h) => {
    ctx.fillStyle = "#090b14";
    ctx.fillRect(0, 0, w, h);
    const span = Math.max(2000, ms * 8);
    const X = (tms: number) => 20 + (tms / span) * (w - 30);
    const beatMs = 60000 / bpm;
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    for (let b = 0; b * beatMs <= span; b++) {
      ctx.strokeStyle = b % 4 === 0 ? COLORS.grid2 : COLORS.grid;
      ctx.beginPath(); ctx.moveTo(X(b * beatMs), 0); ctx.lineTo(X(b * beatMs), h); ctx.stroke();
      if (b % 4 === 0) { ctx.fillStyle = COLORS.label; ctx.fillText(`bar ${b / 4 + 1}`, X(b * beatMs) + 3, h - 4); }
    }
    const mid = h / 2;
    ctx.strokeStyle = COLORS.grid2;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
    ctx.fillStyle = COLORS.label;
    ctx.fillText("L", 4, 14);
    ctx.fillText("R", 4, h - 16);
    const bar = (x: number, level: number, side: number, color: string) => {
      // Heights on a 48 dB scale, so quiet repeats stay visible.
      const len = clamp((20 * Math.log10(Math.max(1e-4, level)) + 48) / 48, 0.04, 1) * (mid - 10);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      if (side <= 0) ctx.fillRect(x - 3, mid - len, 6, len);
      if (side >= 0) ctx.fillRect(x - 3, mid, 6, len);
      ctx.shadowBlur = 0;
    };
    bar(X(0), 1, 0, "#cfd3e6");
    let level = mix;
    for (let n = 1; n < 24 && level > 0.004; n++) {
      const tms = n * ms;
      if (tms > span) break;
      const side = ping ? (n % 2 === 1 ? 1 : -1) : 0;
      bar(X(tms), level, side, n % 2 ? COLORS.cyan : COLORS.violet2);
      level *= fb;
    }
    ctx.fillStyle = "rgba(232,234,242,0.85)";
    ctx.font = "bold 12px Inter, Segoe UI, sans-serif";
    ctx.fillText(`${ms.toFixed(0)} ms${sync > 0 ? ` · ${NOTE_VALUES[sync].name} at ${bpm.toFixed(0)} BPM` : ""}`, 22, 16);
  }, [ms, fb, ping, mix, bpm, sync]);

  const filt = useCanvas((ctx, w, h) => {
    ctx.fillStyle = "#090b14";
    ctx.fillRect(0, 0, w, h);
    const x0 = freqToX(lowCut, w), x1 = freqToX(highCut, w);
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, rgba(COLORS.cyan, 0.05));
    g.addColorStop(0.15, rgba(COLORS.cyan, 0.35));
    g.addColorStop(0.85, rgba(COLORS.cyan, 0.35));
    g.addColorStop(1, rgba(COLORS.cyan, 0.05));
    ctx.fillStyle = g;
    ctx.fillRect(x0, 6, x1 - x0, h - 12);
    ctx.fillStyle = COLORS.label;
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    ctx.fillText("echo tone", x0 + 4, h / 2 + 3);
  }, [lowCut, highCut]);

  return (
    <div className="fx-layout">
      <div className="fx-row top">
        <Section title="Echoes" className="grow"><canvas ref={taps.ref} className="fx-canvas" style={{ height: 190 }} /></Section>
        <div className="fx-meters"><Meter db={t.inDb} label="In" height={190} /><Meter db={t.outDb} label="Out" height={190} color={COLORS.cyan} /></div>
      </div>
      <div className="fx-row knobs">
        <Pick fx={fx} pid="sync" label="Tempo sync" />
        <Knob fx={fx} pid="time" label="Free time" disabled={sync > 0} color={COLORS.cyan} size={58} />
        <Knob fx={fx} pid="feedback" color={COLORS.violet2} size={58} />
        <Toggle fx={fx} pid="pingPong" label="Ping-pong" />
        <div className="col" style={{ gap: 4, width: 160 }}>
          <span className="fx-label">Echo filter</span>
          <canvas ref={filt.ref} className="fx-canvas" style={{ height: 36 }} />
        </div>
        <Knob fx={fx} pid="lowCut" label="Low cut" color={COLORS.amber} />
        <Knob fx={fx} pid="highCut" label="High cut" color={COLORS.amber} />
        <Knob fx={fx} pid="mix" label="Dry / wet" color={COLORS.green} />
      </div>
      <Presets fx={fx} presets={DELAY_PRESETS} />
    </div>
  );
}

/** Lissajous goniometer of the output with a correlation meter. */
function Goniometer({ t, height = 200 }: { t: { scopeL?: number[]; scopeR?: number[]; correlation?: number }; height?: number }) {
  const { ref } = useCanvas((ctx, w, h) => {
    ctx.fillStyle = "#090b14";
    ctx.fillRect(0, 0, w, h);
    const cxp = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 10;
    ctx.strokeStyle = COLORS.grid2;
    ctx.beginPath(); ctx.moveTo(cxp, cy - r); ctx.lineTo(cxp, cy + r); ctx.moveTo(cxp - r, cy); ctx.lineTo(cxp + r, cy); ctx.stroke();
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(cxp - r * 0.7, cy - r * 0.7); ctx.lineTo(cxp + r * 0.7, cy + r * 0.7); ctx.moveTo(cxp + r * 0.7, cy - r * 0.7); ctx.lineTo(cxp - r * 0.7, cy + r * 0.7); ctx.stroke();
    ctx.fillStyle = COLORS.label;
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    ctx.fillText("M", cxp + 3, cy - r + 10);
    ctx.fillText("L", cxp - r * 0.7 - 10, cy - r * 0.7);
    ctx.fillText("R", cxp + r * 0.7 + 4, cy - r * 0.7);
    const L = t.scopeL ?? [], R = t.scopeR ?? [];
    let peak = 0.05;
    for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const gain = Math.min(4, 0.9 / peak);
    ctx.fillStyle = rgba(COLORS.green, 0.55);
    for (let i = 0; i < L.length; i++) {
      const side = (L[i] - R[i]) * 0.7071 * gain, mid = (L[i] + R[i]) * 0.7071 * gain;
      ctx.fillRect(cxp + side * r - 1, cy - mid * r - 1, 2, 2);
    }
  }, [t.scopeL, t.scopeR]);
  const corr = t.correlation ?? 1;
  return (
    <div className="col" style={{ gap: 6 }}>
      <canvas ref={ref} className="fx-canvas square" style={{ height }} />
      <div className="fx-corr">
        <span>-1</span>
        <div className="bar"><div className="dot" style={{ left: `${((clamp(corr, -1, 1) + 1) / 2) * 100}%`, background: corr < 0 ? COLORS.red : corr < 0.3 ? COLORS.amber : COLORS.green }} /></div>
        <span>+1</span>
      </div>
      <span className="small faint" style={{ textAlign: "center" }}>Correlation {corr.toFixed(2)}{corr < 0 ? ": phase problems in mono" : ""}</span>
    </div>
  );
}

export function WidthEditor({ fx, pluginId }: { fx: Fx; pluginId: string }) {
  const t = useTelemetry(pluginId, { scope: true }, 24);
  const width = fx.v("width", 120);
  const field = useCanvas((ctx, w, h) => {
    ctx.fillStyle = "#090b14";
    ctx.fillRect(0, 0, w, h);
    const cxp = w / 2, base = h - 12;
    const spread = clamp(width / 200, 0, 1) * (Math.PI / 2) * 0.95;
    const g = ctx.createRadialGradient(cxp, base, 0, cxp, base, h - 20);
    g.addColorStop(0, rgba(COLORS.violet, 0.6));
    g.addColorStop(1, rgba(COLORS.cyan, 0.05));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cxp, base);
    ctx.arc(cxp, base, h - 20, -Math.PI / 2 - spread, -Math.PI / 2 + spread);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(232,234,242,0.85)";
    ctx.font = "bold 12px Inter, Segoe UI, sans-serif";
    ctx.fillText(width < 1 ? "Mono" : width < 100 ? "Narrower" : width > 100 ? "Wider" : "Original", 10, 18);
  }, [width]);
  return (
    <div className="fx-layout">
      <div className="fx-row top">
        <Section title="Vectorscope"><Goniometer t={t} height={220} /></Section>
        <Section title="Stereo field" className="grow"><canvas ref={field.ref} className="fx-canvas" style={{ height: 220 }} /></Section>
        <div className="fx-meters"><Meter db={t.inDb} label="In" height={220} /><Meter db={t.outDb} label="Out" height={220} color={COLORS.cyan} /></div>
      </div>
      <div className="fx-row knobs">
        <Knob fx={fx} pid="width" color={COLORS.violet2} size={66} />
        <Knob fx={fx} pid="bassMono" label="Mono below" color={COLORS.amber} format={(p) => (p.value < 1 ? "Off" : `${p.value.toFixed(0)} Hz`)} />
        <Knob fx={fx} pid="output" color={COLORS.cyan} />
        <div className="fx-note">Keep correlation above 0 so the mix still works in mono. "Mono below" keeps the bass centred while you widen the rest.</div>
      </div>
      <Presets fx={fx} presets={WIDTH_PRESETS} />
    </div>
  );
}

export function DoublerEditor({ fx, pluginId }: { fx: Fx; pluginId: string }) {
  const t = useTelemetry(pluginId, { scope: true }, 20);
  const detune = fx.v("detune", 12), delay = fx.v("delay", 18), width = fx.v("width", 100) / 100, mix = fx.v("mix", 50) / 100;
  const voices = useCanvas((ctx, w, h) => {
    ctx.fillStyle = "#090b14";
    ctx.fillRect(0, 0, w, h);
    const cxp = w / 2;
    ctx.strokeStyle = COLORS.grid2;
    ctx.beginPath(); ctx.moveTo(cxp, 10); ctx.lineTo(cxp, h - 10); ctx.stroke();
    const voice = (pan: number, cents: number, ms: number, color: string, label: string, size: number) => {
      const x = cxp + pan * (w / 2 - 40);
      const y = h / 2 - (cents / 40) * (h / 2 - 24);
      ctx.fillStyle = rgba(color, 0.25);
      ctx.beginPath(); ctx.arc(x, y, size + ms / 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = COLORS.label;
      ctx.font = "10px Inter, Segoe UI, sans-serif";
      ctx.fillText(label, x - 20, y + size + 14);
    };
    voice(0, 0, 0, "#e8eaf2", "original", 9);
    voice(-width, detune / 2, delay, COLORS.cyan, `+${(detune / 2).toFixed(0)}¢ ${delay.toFixed(0)} ms`, 5 + mix * 6);
    voice(width, -detune / 2, delay * 1.37, COLORS.pink, `-${(detune / 2).toFixed(0)}¢ ${(delay * 1.37).toFixed(0)} ms`, 5 + mix * 6);
    ctx.fillStyle = COLORS.label;
    ctx.fillText("L", 6, h / 2);
    ctx.fillText("R", w - 12, h / 2);
  }, [detune, delay, width, mix]);
  return (
    <div className="fx-layout">
      <div className="fx-row top">
        <Section title="Voices: pan, detune, delay" className="grow"><canvas ref={voices.ref} className="fx-canvas" style={{ height: 210 }} /></Section>
        <Section title="Vectorscope"><Goniometer t={t} height={170} /></Section>
      </div>
      <div className="fx-row knobs">
        <Knob fx={fx} pid="detune" color={COLORS.pink} size={60} />
        <Knob fx={fx} pid="delay" color={COLORS.cyan} size={60} />
        <Knob fx={fx} pid="width" color={COLORS.violet2} />
        <Knob fx={fx} pid="mix" label="Double level" color={COLORS.green} />
      </div>
      <Presets fx={fx} presets={DOUBLER_PRESETS} />
    </div>
  );
}

export function TremoloEditor({ fx, pluginId }: { fx: Fx; pluginId: string }) {
  const t = useTelemetry(pluginId, {}, 30);
  const shape = fx.c("shape"), depth = fx.v("depth", 60) / 100, pan = fx.c("mode") === 1, sync = fx.c("sync");
  const phase = (t.phase as number | undefined) ?? 0;
  const rate = (t.rateHz as number | undefined) ?? fx.v("rate", 4);
  const { ref } = useCanvas((ctx, w, h) => {
    ctx.fillStyle = "#090b14";
    ctx.fillRect(0, 0, w, h);
    const cycles = 2;
    ctx.strokeStyle = COLORS.grid;
    for (let c = 0; c <= cycles; c++) { const x = (c / cycles) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    const Y = (g: number) => h - 10 - g * (h - 20);
    const plot = (fn: (p: number) => number, color: string) => {
      ctx.beginPath();
      for (let i = 0; i <= w; i++) {
        const p = ((i / w) * cycles) % 1;
        if (i) ctx.lineTo(i, Y(fn(p))); else ctx.moveTo(0, Y(fn(p)));
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.stroke();
    };
    if (pan) {
      plot((p) => 0.5 + (lfo(shape, p) - 0.5) * depth, COLORS.cyan);
      ctx.fillStyle = COLORS.label;
      ctx.font = "10px Inter, Segoe UI, sans-serif";
      ctx.fillText("right", 6, 14);
      ctx.fillText("left", 6, h - 4);
    } else {
      plot((p) => 1 - depth * (1 - lfo(shape, p)), COLORS.violet2);
    }
    const x = (((phase % 1) + 1) % 1) * (w / cycles);
    const g = pan ? 0.5 + (lfo(shape, phase) - 0.5) * depth : 1 - depth * (1 - lfo(shape, phase));
    ctx.fillStyle = "#fff";
    ctx.shadowColor = COLORS.cyan;
    ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(x, Y(g), 6, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(232,234,242,0.85)";
    ctx.font = "bold 12px Inter, Segoe UI, sans-serif";
    ctx.fillText(`${rate.toFixed(2)} Hz${sync > 0 ? ` · ${NOTE_VALUES[sync].name}` : ""}`, w - 150, 16);
  }, [shape, depth, pan, phase, rate, sync]);

  const panPos = pan ? (lfo(shape, phase) - 0.5) * depth * 2 : 0;
  return (
    <div className="fx-layout">
      <div className="fx-row top">
        <Section title={pan ? "Pan position over time" : "Volume over time"} className="grow"><canvas ref={ref} className="fx-canvas" style={{ height: 190 }} /></Section>
        <div className="fx-meters"><Meter db={t.inDb} label="In" height={190} /><Meter db={t.outDb} label="Out" height={190} color={COLORS.cyan} /></div>
      </div>
      {pan && (
        <div className="fx-panbar"><span>L</span><div className="bar"><div className="dot" style={{ left: `${(panPos + 1) * 50}%` }} /></div><span>R</span></div>
      )}
      <div className="fx-row knobs">
        <Seg fx={fx} pid="mode" label="Mode" />
        <Seg fx={fx} pid="shape" label="Shape" />
        <Pick fx={fx} pid="sync" label="Tempo sync" />
        <Knob fx={fx} pid="rate" disabled={sync > 0} color={COLORS.cyan} size={58} />
        <Knob fx={fx} pid="depth" color={COLORS.violet2} size={58} />
      </div>
      <Presets fx={fx} presets={TREMOLO_PRESETS} />
    </div>
  );
}

export function ReverbEditor({ fx }: { fx: Fx }) {
  const size = fx.v("room size", 0.5), damp = fx.v("damping", 0.5), wet = fx.v("wet level", 0.33), dry = fx.v("dry level", 0.4), width = fx.v("width", 1);
  const frozen = fx.v("mode", 0) >= 0.5;
  const { ref } = useCanvas((ctx, w, h) => {
    ctx.fillStyle = "#090b14";
    ctx.fillRect(0, 0, w, h);
    const decay = frozen ? 1e9 : 0.3 + size * 4.5;
    const span = 6;
    ctx.strokeStyle = COLORS.grid;
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    for (let s = 0; s <= span; s++) {
      const x = (s / span) * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillStyle = COLORS.label;
      ctx.fillText(`${s}s`, x + 3, h - 4);
    }
    // Dense reflections under an exponential decay; damping darkens (and shortens) the high end.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < w; i += 2) {
      const tSec = (i / w) * span;
      // Drawn in dB (60 dB of decay over the decay time) so the tail reads as long as it sounds.
      const level = 0.35 + wet * 0.65;
      const env = clamp(1 - tSec / decay, 0, 1) * level;
      const hiEnv = clamp(1 - tSec / (decay * (1 - damp * 0.8)), 0, 1) * level;
      const r1 = rnd(), r2 = rnd();
      ctx.fillStyle = rgba(COLORS.violet2, 0.55);
      const a = env * (0.5 + r1 * 0.5) * (h / 2 - 10);
      ctx.fillRect(i, h / 2 - a, 1.5, a * 2);
      ctx.fillStyle = rgba(COLORS.cyan, 0.5);
      const b = hiEnv * (0.4 + r2 * 0.4) * (h / 2 - 10);
      ctx.fillRect(i, h / 2 - b, 1.5, b * 2);
    }
    ctx.fillStyle = "#e8eaf2";
    ctx.fillRect(0, h / 2 - dry * (h / 2 - 10), 3, dry * (h - 20));
    ctx.fillStyle = "rgba(232,234,242,0.85)";
    ctx.font = "bold 12px Inter, Segoe UI, sans-serif";
    ctx.fillText(frozen ? "Frozen: infinite sustain" : `Decay ≈ ${decay.toFixed(1)} s`, 10, 18);
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    ctx.fillStyle = COLORS.cyan;
    ctx.fillText("● highs", 10, 32);
    ctx.fillStyle = COLORS.violet2;
    ctx.fillText("● body", 60, 32);
  }, [size, damp, wet, dry, frozen]);

  const room = useCanvas((ctx, w, h) => {
    ctx.fillStyle = "#090b14";
    ctx.fillRect(0, 0, w, h);
    const s = 0.25 + size * 0.7;
    const rw = w * s * (0.6 + width * 0.4), rh = h * s;
    ctx.strokeStyle = COLORS.violet2;
    ctx.lineWidth = 2;
    ctx.strokeRect((w - rw) / 2, (h - rh) / 2, rw, rh);
    ctx.fillStyle = rgba(COLORS.violet, 0.12 + (1 - damp) * 0.15);
    ctx.fillRect((w - rw) / 2, (h - rh) / 2, rw, rh);
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 4, 0, Math.PI * 2); ctx.fill();
  }, [size, width, damp]);

  return (
    <div className="fx-layout">
      <div className="fx-row top">
        <Section title="Decay" className="grow"><canvas ref={ref} className="fx-canvas" style={{ height: 190 }} /></Section>
        <Section title="Room"><canvas ref={room.ref} className="fx-canvas square" style={{ height: 190 }} /></Section>
      </div>
      <div className="fx-row knobs">
        <Knob fx={fx} pid="room size" label="Size" color={COLORS.violet2} size={62} format={(p) => `${(0.3 + p.value * 4.5).toFixed(1)} s`} />
        <Knob fx={fx} pid="damping" color={COLORS.amber} size={56} />
        <Knob fx={fx} pid="width" color={COLORS.cyan} />
        <Knob fx={fx} pid="wet level" label="Wet" color={COLORS.green} />
        <Knob fx={fx} pid="dry level" label="Dry" color="#cfd3e6" />
        <button className={cx("fx-toggle", frozen && "on")} onClick={() => fx.set("mode", frozen ? 0 : 1)}><span className="led" /> Freeze</button>
      </div>
      <Presets fx={fx} presets={REVERB_PRESETS} />
    </div>
  );
}

/** Tracktion's chorus: depth, speed, stereo width and mix, with the two voices drawn as they move. */
export function ChorusEditor({ fx }: { fx: Fx }) {
  const depth = fx.v("depthMs", 3);
  const speed = fx.v("speedHz", 1);
  const width = fx.v("width", 0.5);
  const mix = fx.v("mixProportion", 0.5);
  const ref = useRef<HTMLCanvasElement>(null);
  const phase = useRef(0);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      phase.current = (phase.current + dt * speed) % 1;
      const el = ref.current;
      if (el) {
        const dpr = window.devicePixelRatio || 1;
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (w && h) {
          if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
            el.width = Math.round(w * dpr);
            el.height = Math.round(h * dpr);
          }
          const ctx = el.getContext("2d");
          if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = "#090b14";
            ctx.fillRect(0, 0, w, h);
            const mid = h / 2;
            const amp = h * 0.34 * (0.2 + depth / 30);
            const plot = (offset: number, color: string) => {
              ctx.beginPath();
              for (let x = 0; x <= w; x++) {
                const p = (x / w + phase.current + offset) % 1;
                const y = mid - Math.sin(p * Math.PI * 2) * amp;
                if (x) ctx.lineTo(x, y);
                else ctx.moveTo(x, y);
              }
              ctx.strokeStyle = color;
              ctx.globalAlpha = 0.3 + mix * 0.7;
              ctx.lineWidth = 2.2;
              ctx.stroke();
              ctx.globalAlpha = 1;
            };
            plot(0, COLORS.cyan);
            plot(width * 0.5, COLORS.pink);
            const pulse = 0.5 + 0.5 * Math.sin(phase.current * Math.PI * 2);
            ctx.fillStyle = rgba(COLORS.cyan, 0.15 + pulse * mix * 0.35);
            ctx.fillRect(12, h - 28, (w - 24) * (0.15 + mix * pulse), 8);
            ctx.fillStyle = "rgba(232,234,242,0.85)";
            ctx.font = "bold 12px Inter, Segoe UI, sans-serif";
            ctx.fillText(`${speed.toFixed(2)} Hz  ·  ${depth.toFixed(1)} ms of movement`, 12, 18);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [depth, speed, width, mix]);

  return (
    <div className="fx-layout">
      <Section title="How the voices move"><canvas ref={ref} className="fx-canvas" style={{ height: 180 }} /></Section>
      <div className="fx-row knobs">
        <Knob fx={fx} pid="depthMs" label="Depth" color={COLORS.cyan} size={64} />
        <Knob fx={fx} pid="speedHz" label="Speed" color={COLORS.violet2} size={64} />
        <Knob fx={fx} pid="width" label="Width" color={COLORS.pink} size={56} />
        <Knob fx={fx} pid="mixProportion" label="Mix" color={COLORS.green} size={56} />
      </div>
      <div className="fx-note">Depth is how far the voices drift. Speed is how fast that drift moves. Width pulls the two voices apart. Mix is the chorus against the dry sound.</div>
      <Presets fx={fx} presets={CHORUS_PRESETS} />
    </div>
  );
}
