// Editors for dynamics: compressor, gate, de-esser, transient shaper and limiter.
import { useRef } from "react";
import { COLORS, Knob, Meter, Presets, Section, Seg, Toggle, rgba, useAnalyserFrame, useCanvas, useHistory, useTelemetry, drawFreqGrid, drawSpectrum } from "./core";
import type { Fx, Telemetry } from "./core";
import { clamp, compGainDb, freqToX, gainToDb, xToFreq } from "./dsp";
import { knobLook } from "./knobLook";
import { CLASSIC_COMP_PRESETS, COMP_PRESETS, DEESSER_PRESETS, GATE_PRESETS, LIMITER_PRESETS, TRANSIENT_PRESETS } from "./presets";

/** Scrolling history of level (filled) with an optional second trace and horizontal markers. */
function HistoryGraph({ level, trace, lines = [], min = -60, traceColor = COLORS.red, traceFromTop, height = 150, onDragLine }: {
  level: number[]; trace?: number[]; lines?: { db: number; color: string; label: string }[]; min?: number; traceColor?: string; traceFromTop?: boolean; height?: number;
  onDragLine?: (db: number) => void;
}) {
  const dragging = useRef(false);
  const { ref } = useCanvas((ctx, w, h) => {
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, w, h);
    const Y = (db: number) => h - (clamp(db, min, 0) - min) / -min * h;
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    for (let db = 0; db >= min; db -= 12) {
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath(); ctx.moveTo(0, Math.round(Y(db)) + 0.5); ctx.lineTo(w, Math.round(Y(db)) + 0.5); ctx.stroke();
      ctx.fillStyle = COLORS.label;
      ctx.fillText(`${db}`, 4, Y(db) + (db === 0 ? 11 : -3));
    }
    const step = w / (level.length - 1);
    ctx.beginPath();
    ctx.moveTo(0, h);
    level.forEach((v, i) => ctx.lineTo(i * step, Y(v)));
    ctx.lineTo(w, h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(COLORS.cyan, 0.55));
    g.addColorStop(1, rgba(COLORS.violet, 0.08));
    ctx.fillStyle = g;
    ctx.fill();
    if (trace) {
      ctx.beginPath();
      trace.forEach((v, i) => {
        const y = traceFromTop ? clamp(v / 24, 0, 1) * h : Y(v);
        if (i) ctx.lineTo(i * step, y); else ctx.moveTo(0, y);
      });
      ctx.strokeStyle = traceColor;
      ctx.lineWidth = 2;
      ctx.shadowColor = traceColor;
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    for (const l of lines) {
      ctx.strokeStyle = l.color;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(0, Y(l.db)); ctx.lineTo(w, Y(l.db)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = l.color;
      ctx.fillText(`${l.label} ${l.db.toFixed(1)} dB`, w - 120, Y(l.db) - 4);
    }
  }, [level, trace, lines.map((l) => l.db).join()]);

  const toDb = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return clamp(min - ((e.clientY - r.top - r.height) / r.height) * -min, min, 0);
  };

  return (
    <canvas ref={ref} className="fx-canvas" style={{ height, cursor: onDragLine ? "ns-resize" : undefined }}
      onPointerDown={(e) => { if (!onDragLine) return; (e.target as Element).setPointerCapture(e.pointerId); dragging.current = true; onDragLine(toDb(e)); }}
      onPointerMove={(e) => dragging.current && onDragLine?.(toDb(e))}
      onPointerUp={() => (dragging.current = false)} />
  );
}

//==============================================================================
interface CompModel { threshold: number; ratio: number; knee: number; makeup: number; setThreshold?: (db: number) => void; setRatio?: (r: number) => void }

/** Input level → output level, with the knee, the current operating point and drag handles. */
function TransferCurve({ m, levelDb }: { m: CompModel; levelDb?: number }) {
  const drag = useRef<"threshold" | "ratio" | null>(null);
  const min = -60;
  const { ref } = useCanvas((ctx, w, h) => {
    const X = (db: number) => ((clamp(db, min, 0) - min) / -min) * w;
    const Y = (db: number) => h - ((clamp(db, min, 6) - min) / (6 - min)) * h;
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, w, h);
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    for (let db = 0; db >= min; db -= 12) {
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath(); ctx.moveTo(X(db) + 0.5, 0); ctx.lineTo(X(db) + 0.5, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, Y(db) + 0.5); ctx.lineTo(w, Y(db) + 0.5); ctx.stroke();
      ctx.fillStyle = COLORS.label;
      ctx.fillText(`${db}`, X(db) + 3, h - 4);
    }
    ctx.strokeStyle = COLORS.grid2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(X(min), Y(min)); ctx.lineTo(X(0), Y(0)); ctx.stroke();
    ctx.setLineDash([]);

    if (m.knee > 0) {
      ctx.fillStyle = rgba(COLORS.amber, 0.07);
      ctx.fillRect(X(m.threshold - m.knee / 2), 0, X(m.threshold + m.knee / 2) - X(m.threshold - m.knee / 2), h);
    }
    ctx.strokeStyle = rgba(COLORS.amber, 0.7);
    ctx.beginPath(); ctx.moveTo(X(m.threshold), 0); ctx.lineTo(X(m.threshold), h); ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const inDb = min + (i / 200) * -min;
      const out = inDb + compGainDb(inDb, m.threshold, m.ratio, m.knee) + m.makeup;
      if (i) ctx.lineTo(X(inDb), Y(out)); else ctx.moveTo(X(inDb), Y(out));
    }
    ctx.save();
    ctx.strokeStyle = COLORS.violet2;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = COLORS.violet;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();

    const thrOut = m.threshold + compGainDb(m.threshold, m.threshold, m.ratio, m.knee) + m.makeup;
    ctx.fillStyle = COLORS.amber;
    ctx.beginPath(); ctx.arc(X(m.threshold), Y(thrOut), 6, 0, Math.PI * 2); ctx.fill();

    if (levelDb !== undefined && levelDb > min) {
      const out = levelDb + compGainDb(levelDb, m.threshold, m.ratio, m.knee) + m.makeup;
      ctx.fillStyle = COLORS.ink;
      ctx.shadowColor = COLORS.cyan;
      ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(X(levelDb), Y(out), 5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = "bold 12px Inter, Segoe UI, sans-serif";
    ctx.fillText(`${m.ratio >= 19.5 ? "∞" : m.ratio.toFixed(1)} : 1`, 10, 18);
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    ctx.fillStyle = COLORS.amber;
    ctx.fillText(`Threshold ${m.threshold.toFixed(1)} dB`, 10, 32);
  }, [m.threshold, m.ratio, m.knee, m.makeup, levelDb]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return { inDb: min + (x / r.width) * -min, outDb: min + ((r.height - y) / r.height) * (6 - min), x, w: r.width };
  };

  return (
    <canvas ref={ref} className="fx-canvas square"
      onPointerDown={(e) => {
        if (!m.setThreshold) return;
        const p = pos(e);
        (e.target as Element).setPointerCapture(e.pointerId);
        drag.current = Math.abs(p.inDb - m.threshold) < 4 || p.inDb < m.threshold ? "threshold" : "ratio";
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const p = pos(e);
        if (drag.current === "threshold") m.setThreshold?.(clamp(p.inDb, -60, 0));
        else {
          const over = p.inDb - m.threshold;
          const rise = p.outDb - m.makeup - m.threshold;
          if (over > 1) m.setRatio?.(clamp(over / Math.max(0.05, rise), 1, 20));
        }
      }}
      onPointerUp={() => (drag.current = null)} />
  );
}

export function CompressorEditor({ fx, pluginId }: { fx: Fx; pluginId: string }) {
  const t = useTelemetry(pluginId, {}, 24);
  const level = useHistory(t, (x) => x.levelDb as number | undefined);
  const gr = useHistory(t, (x) => x.grDb as number | undefined, 160, 0);
  const autoMakeup = fx.c("autoMakeup") === 1;
  const threshold = fx.v("threshold", -18), ratio = fx.v("ratio", 4), knee = fx.v("knee", 0);
  const makeup = fx.v("makeup", 0) + (autoMakeup ? -0.5 * compGainDb(0, threshold, ratio, knee) : 0);
  const m: CompModel = { threshold, ratio, knee, makeup, setThreshold: (db) => fx.set("threshold", db), setRatio: (r) => fx.set("ratio", r) };

  return (
    <div className="fx-layout">
      <div className="fx-row top">
        <Section title="Transfer curve" className="fx-curve-box">
          <TransferCurve m={m} levelDb={t.levelDb as number | undefined} />
        </Section>
        <Section title="Gain reduction" className="grow">
          <HistoryGraph level={level} trace={gr} traceFromTop lines={[{ db: threshold, color: COLORS.amber, label: "Threshold" }]} height={196}
            onDragLine={(db) => fx.set("threshold", db)} />
        </Section>
        <div className="fx-meters">
          <Meter db={t.inDb} label="In" height={196} />
          <Meter db={t.grDb as number | undefined} label="GR" gr height={196} />
          <Meter db={t.outDb} label="Out" height={196} color={COLORS.cyan} />
        </div>
      </div>
      <div className="fx-row knobs">
        <Knob fx={fx} pid="threshold" size={58} {...knobLook("s4000comp", "threshold")} />
        <Knob fx={fx} pid="ratio" size={58} {...knobLook("s4000comp", "ratio")} />
        <Knob fx={fx} pid="knee" {...knobLook("s4000comp", "knee")} />
        <Knob fx={fx} pid="attack" {...knobLook("s4000comp", "attack")} />
        <Knob fx={fx} pid="release" {...knobLook("s4000comp", "release")} />
        <Knob fx={fx} pid="makeup" disabled={false} {...knobLook("s4000comp", "makeup")} />
        <Knob fx={fx} pid="scHpf" {...knobLook("s4000comp", "scHpf")} />
        <Knob fx={fx} pid="mix" {...knobLook("s4000comp", "mix")} />
        <div className="col" style={{ gap: 8 }}>
          <Toggle fx={fx} pid="autoMakeup" label="Auto make-up" />
          <Seg fx={fx} pid="detect" small />
        </div>
      </div>
      <Presets fx={fx} presets={COMP_PRESETS} />
    </div>
  );
}

/** The engine's original compressor: linear threshold and an inverted ratio, drawn on the same curve. */
export function ClassicCompressorEditor({ fx }: { fx: Fx }) {
  const threshold = gainToDb(fx.v("threshold", 0.5));
  const ratio = 1 / Math.max(0.05, fx.v("ratio", 0.5));
  const m: CompModel = {
    threshold, ratio, knee: 0, makeup: fx.v("output gain", 0),
    setThreshold: (db) => fx.set("threshold", Math.pow(10, db / 20)),
    setRatio: (r) => fx.set("ratio", 1 / r),
  };
  return (
    <div className="fx-layout">
      <div className="fx-row top">
        <Section title="Transfer curve" className="fx-curve-box"><TransferCurve m={m} /></Section>
        <div className="col grow" style={{ gap: 10 }}>
          <div className="fx-row knobs">
            <Knob fx={fx} pid="threshold" size={58} {...knobLook("compressor", "threshold")} format={() => `${threshold.toFixed(1)} dB`} />
            <Knob fx={fx} pid="ratio" size={58} {...knobLook("compressor", "ratio")} format={() => `${ratio.toFixed(1)} : 1`} />
            <Knob fx={fx} pid="attack" {...knobLook("compressor", "attack")} />
            <Knob fx={fx} pid="release" {...knobLook("compressor", "release")} />
            <Knob fx={fx} pid="output gain" {...knobLook("compressor", "output gain")} />
            <Knob fx={fx} pid="input gain" {...knobLook("compressor", "input gain")} />
          </div>
          <p className="small faint">The Classic Compressor has no live meters. Swap in the Studio 4000 Compressor for gain-reduction metering, soft knee, RMS detection and parallel mix.</p>
          <Presets fx={fx} presets={CLASSIC_COMP_PRESETS} />
        </div>
      </div>
    </div>
  );
}

//==============================================================================
export function GateEditor({ fx, pluginId }: { fx: Fx; pluginId: string }) {
  const t = useTelemetry(pluginId, {}, 24);
  const threshold = fx.v("threshold", -45), range = fx.v("range", -60);
  const level = useHistory(t, (x) => x.levelDb as number | undefined, 160, -90);
  const gain = useHistory(t, (x) => x.gainDb as number | undefined, 160, range);
  const open = t.open === true;
  return (
    <div className="fx-layout">
      <div className="fx-row top">
        <Section title="Level and gate" className="grow" right={<span className={open ? "fx-state on" : "fx-state"}>{open ? "OPEN" : "CLOSED"}</span>}>
          <HistoryGraph level={level} trace={gain} traceColor={COLORS.green} min={-80} height={210}
            lines={[{ db: threshold, color: COLORS.amber, label: "Opens at" }, { db: Math.max(-80, threshold + gainToDb(0.7)), color: rgba(COLORS.amber, 0.45), label: "Closes at" }]}
            onDragLine={(db) => fx.set("threshold", db)} />
        </Section>
        <div className="fx-meters">
          <Meter db={t.inDb} label="In" height={210} />
          <Meter db={-((t.gainDb as number | undefined) ?? 0)} label="Atten." gr height={210} />
          <Meter db={t.outDb} label="Out" height={210} color={COLORS.cyan} />
        </div>
      </div>
      <div className="fx-row knobs">
        <Knob fx={fx} pid="threshold" size={58} {...knobLook("s4000gate", "threshold")} />
        <Knob fx={fx} pid="range" {...knobLook("s4000gate", "range")} format={(p) => (p.value <= -89.5 ? "Silent" : p.text)} />
        <Knob fx={fx} pid="attack" {...knobLook("s4000gate", "attack")} />
        <Knob fx={fx} pid="hold" {...knobLook("s4000gate", "hold")} />
        <Knob fx={fx} pid="release" {...knobLook("s4000gate", "release")} />
        <div className="fx-note">Green line: the gate's gain. It stays at 0 dB while the signal is above the threshold, then falls to the floor ({range.toFixed(0)} dB) after the hold time.</div>
      </div>
      <Presets fx={fx} presets={GATE_PRESETS} />
    </div>
  );
}

//==============================================================================
export function DeEsserEditor({ fx, pluginId }: { fx: Fx; pluginId: string }) {
  const t = useTelemetry(pluginId, { spectrum: true }, 24);
  const spec = useAnalyserFrame(t.spectrumIn);
  const freq = fx.v("frequency", 6000);
  const dragging = useRef(false);
  const reduction = useHistory(t, (x) => x.reductionDb as number | undefined, 160, 0);
  const sib = useHistory(t, (x) => x.sibilanceDb as number | undefined, 160, -90);
  const threshold = fx.v("threshold", -30);

  const { ref } = useCanvas((ctx, w, h) => {
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, w, h);
    drawFreqGrid(ctx, w, h, [], (f) => freqToX(f, w));
    const x = freqToX(freq, w);
    const g = ctx.createLinearGradient(x, 0, w, 0);
    g.addColorStop(0, rgba(COLORS.pink, 0.28));
    g.addColorStop(1, rgba(COLORS.pink, 0.05));
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w - x, h);
    if (spec.points.length) {
      ctx.save();
      if (spec.ghost) ctx.globalAlpha = 0.35;
      drawSpectrum(ctx, w, h, spec.points, { color: COLORS.cyan, fill: true, floor: -100, ceil: 6 });
      drawSpectrum(ctx, w, h, spec.points, { color: COLORS.cyan, floor: -100, ceil: 6 });
      ctx.restore();
    }
    ctx.strokeStyle = COLORS.pink;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.fillStyle = COLORS.pink;
    ctx.font = "bold 11px Inter, Segoe UI, sans-serif";
    ctx.fillText(`Sibilance band from ${(freq / 1000).toFixed(1)} kHz`, Math.min(x + 8, w - 170), 16);
  }, [spec.points, spec.ghost, freq]);

  const setFromX = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    fx.set("frequency", clamp(xToFreq(e.clientX - r.left, r.width), 2000, 12000));
  };

  return (
    <div className="fx-layout">
      <div className="fx-row top">
        <Section title="Input spectrum: drag to set where S sounds start" className="grow">
          <canvas ref={ref} className="fx-canvas" style={{ height: 180, cursor: "ew-resize" }}
            onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); dragging.current = true; setFromX(e); }}
            onPointerMove={(e) => dragging.current && setFromX(e)}
            onPointerUp={() => (dragging.current = false)} />
        </Section>
        <div className="fx-meters">
          <Meter db={t.sibilanceDb as number | undefined} label="S level" height={180} color={COLORS.pink} />
          <Meter db={t.reductionDb as number | undefined} label="Reduce" gr height={180} />
        </div>
      </div>
      <Section title="Sibilance against threshold, and the reduction applied">
        <HistoryGraph level={sib} trace={reduction} traceFromTop traceColor={COLORS.red} min={-72} height={110}
          lines={[{ db: threshold, color: COLORS.amber, label: "Threshold" }]} onDragLine={(db) => fx.set("threshold", db)} />
      </Section>
      <div className="fx-row knobs">
        <Knob fx={fx} pid="frequency" size={56} {...knobLook("s4000deesser", "frequency")} />
        <Knob fx={fx} pid="threshold" size={56} {...knobLook("s4000deesser", "threshold")} />
        <Knob fx={fx} pid="range" {...knobLook("s4000deesser", "range")} />
        <Toggle fx={fx} pid="listen" label="Listen to the S band only" />
      </div>
      <Presets fx={fx} presets={DEESSER_PRESETS} />
    </div>
  );
}

//==============================================================================
export function TransientEditor({ fx, pluginId }: { fx: Fx; pluginId: string }) {
  const t = useTelemetry(pluginId, {}, 24);
  const attack = fx.v("attack", 0) / 100, sustain = fx.v("sustain", 0) / 100;
  const boost = useHistory(t, (x) => (x.boostDb as number | undefined) ?? 0, 120, 0);
  const cut = useHistory(t, (x) => (x.cutDb as number | undefined) ?? 0, 120, 0);

  const { ref } = useCanvas((ctx, w, h) => {
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, w, h);
    const env = (x: number, a: number, s: number) => {
      // A drum-like hit: fast rise, a peak, then an exponential tail.
      const rise = Math.min(1, x / 0.04);
      const peak = x < 0.04 ? rise : Math.exp(-(x - 0.04) * 9);
      const tail = x < 0.04 ? 0 : Math.exp(-(x - 0.04) * 3.2) * 0.35;
      const onset = Math.max(0, peak - tail);
      return clamp(onset * Math.pow(10, (a * 14) / 20) + tail * Math.pow(10, (s * 14) / 20), 0, 1.6);
    };
    const draw = (a: number, s: number, color: string, fill: boolean) => {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i <= 300; i++) {
        const x = i / 300;
        const y = h - env(x, a, s) / 1.6 * (h - 14);
        ctx.lineTo(x * w, y);
      }
      ctx.lineTo(w, h);
      if (fill) {
        ctx.closePath();
        ctx.fillStyle = rgba(color, 0.25);
        ctx.fill();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = fill ? 2.2 : 1;
      ctx.stroke();
    };
    draw(0, 0, "#6c7390", false);
    draw(attack, sustain, COLORS.orange, true);
    ctx.fillStyle = COLORS.label;
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    ctx.fillText("Grey: original hit · Orange: shaped hit", 10, 14);
    ctx.fillStyle = COLORS.orange;
    ctx.fillText("Attack", w * 0.05, h - 6);
    ctx.fillText("Sustain", w * 0.45, h - 6);
  }, [attack, sustain]);

  const activity = useCanvas((ctx, w, h) => {
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, w, h);
    const mid = h / 2;
    ctx.strokeStyle = COLORS.grid2;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
    const step = w / (boost.length - 1);
    const plot = (vals: number[], sign: number, color: string) => {
      ctx.beginPath();
      ctx.moveTo(0, mid);
      vals.forEach((v, i) => ctx.lineTo(i * step, mid - sign * clamp(v, 0, 12) / 12 * (mid - 4)));
      ctx.lineTo(w, mid);
      ctx.closePath();
      ctx.fillStyle = rgba(color, 0.5);
      ctx.fill();
    };
    plot(boost, 1, COLORS.green);
    plot(cut, -1, COLORS.red);
    ctx.fillStyle = COLORS.label;
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    ctx.fillText("boost", 4, 12);
    ctx.fillText("cut", 4, h - 4);
  }, [boost, cut]);

  return (
    <div className="fx-layout">
      <div className="fx-row top">
        <Section title="Envelope" className="grow"><canvas ref={ref} className="fx-canvas" style={{ height: 180 }} /></Section>
        <div className="fx-meters">
          <Meter db={t.inDb} label="In" height={180} />
          <Meter db={t.outDb} label="Out" height={180} color={COLORS.cyan} />
        </div>
      </div>
      <Section title="Live gain changes"><canvas ref={activity.ref} className="fx-canvas" style={{ height: 70 }} /></Section>
      <div className="fx-row knobs">
        <Knob fx={fx} pid="attack" size={64} {...knobLook("s4000transient", "attack")} />
        <Knob fx={fx} pid="sustain" size={64} {...knobLook("s4000transient", "sustain")} />
        <Knob fx={fx} pid="output" {...knobLook("s4000transient", "output")} />
      </div>
      <Presets fx={fx} presets={TRANSIENT_PRESETS} />
    </div>
  );
}

//==============================================================================
export function LimiterEditor({ fx, pluginId }: { fx: Fx; pluginId: string }) {
  const t: Telemetry = useTelemetry(pluginId, {}, 24);
  const gr = useHistory(t, (x) => (x.grDb as number | undefined) ?? 0, 160, 0);
  const ceiling = fx.v("ceiling", -1);
  const flat = gr.map(() => -90);
  return (
    <div className="fx-layout">
      <div className="fx-row top">
        <Section title="Gain reduction" className="grow">
          <HistoryGraph level={flat} trace={gr} traceFromTop traceColor={COLORS.red} min={-24} height={170}
            lines={[{ db: ceiling, color: COLORS.amber, label: "Ceiling" }]} onDragLine={(db) => fx.set("ceiling", clamp(db, -12, 0))} />
        </Section>
        <div className="fx-meters"><Meter db={t.grDb as number | undefined} label="GR" gr height={170} /></div>
      </div>
      <div className="fx-row knobs">
        <Knob fx={fx} pid="inputGain" size={60} {...knobLook("s4000limiter", "inputGain")} />
        <Knob fx={fx} pid="ceiling" size={60} {...knobLook("s4000limiter", "ceiling")} />
        <Knob fx={fx} pid="release" {...knobLook("s4000limiter", "release")} />
        <div className="fx-note">Brickwall limiting with 5 ms lookahead: peaks never pass the ceiling. Push Drive for loudness and watch the red trace. Above about 6 dB of reduction it starts to sound squashed.</div>
      </div>
      <Presets fx={fx} presets={LIMITER_PRESETS} />
    </div>
  );
}
