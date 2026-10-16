// Parametric EQ editor: live pre/post analyser, draggable band nodes and a per-band strip.
import { useRef, useState } from "react";
import { cx } from "../../util";
import { openMenu } from "../ContextMenu";
import type { MenuItem } from "../ContextMenu";
import { BAND_COLORS, COLORS, Knob, Meter, Pick, Presets, rgba, useAnalyserFrame, useCanvas, useTelemetry, drawFreqGrid, drawSpectrum } from "./core";
import { CLASSIC_EQ_PRESETS, EQ_PRESETS } from "./presets";
import type { Fx } from "./core";
import { EQ, EQ_TYPES, bandDb, clamp, dbToY, formatHz, freqToX, xToFreq, yToDb } from "./dsp";
import type { EqBand } from "./dsp";

interface BandSpec { on?: string; type?: string; fixedType?: number; freq: string; gain: string; q: string; slope?: string }

const STUDIO_BANDS: BandSpec[] = Array.from({ length: 8 }, (_, i) => {
  const b = `b${i + 1}`;
  return { on: `${b}on`, type: `${b}type`, freq: `${b}freq`, gain: `${b}gain`, q: `${b}q`, slope: `${b}slope` };
});

const CLASSIC_BANDS: BandSpec[] = [
  { fixedType: EQ.lowShelf, freq: "Low-pass freq", gain: "Low-pass gain", q: "Low-pass Q" },
  { fixedType: EQ.bell, freq: "Mid freq 1", gain: "Mid gain 1", q: "Mid Q 1" },
  { fixedType: EQ.bell, freq: "Mid freq 2", gain: "Mid gain 2", q: "Mid Q 2" },
  { fixedType: EQ.highShelf, freq: "High-pass freq", gain: "High-pass gain", q: "High-pass Q" },
];

const TYPE_GLYPH = ["⟋", "⌊", "∩", "∨", "⌉", "⟍"];
const hasGain = (t: number) => t === EQ.bell || t === EQ.lowShelf || t === EQ.highShelf;

export function EqEditor({ fx, pluginId, classic }: { fx: Fx; pluginId: string; classic?: boolean }) {
  const specs = classic ? CLASSIC_BANDS : STUDIO_BANDS;
  const [selected, setSelected] = useState(classic ? 1 : 3);
  const [range, setRange] = useState(classic ? 24 : 18);
  const [analyser, setAnalyser] = useState<"off" | "post" | "both">("both");
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ band: number; fine: boolean; x: number; y: number; f: number; g: number } | null>(null);
  const t = useTelemetry(pluginId, { spectrum: !classic && analyser !== "off" }, 24);
  const pre = useAnalyserFrame(analyser === "both" ? t.spectrumIn : undefined);
  const post = useAnalyserFrame(analyser !== "off" ? t.spectrumOut : undefined);
  const sr = t.sampleRate || 48000;

  const bands: EqBand[] = specs.map((s) => {
    const type = s.type ? fx.c(s.type) : s.fixedType ?? EQ.bell;
    return {
      on: s.on ? fx.c(s.on) === 1 : true,
      type,
      freq: fx.v(s.freq, 1000),
      gain: fx.v(s.gain, 0),
      q: fx.v(s.q, 0.71),
      stages: s.slope ? fx.c(s.slope) + 1 : 1,
    };
  });
  const sel = clamp(selected, 0, specs.length - 1);

  const { ref } = useCanvas((ctx, w, h) => {
    const X = (f: number) => freqToX(f, w);
    const Y = (db: number) => dbToY(db, h, range);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0d1020");
    bg.addColorStop(1, "#07080e");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const step = range > 18 ? 6 : range > 9 ? 3 : 2;
    const lines = [];
    for (let db = Math.ceil(-range / step) * step; db < range; db += step) if (Math.abs(db) < range) lines.push({ db, y: Y(db) });
    drawFreqGrid(ctx, w, h, lines, X);

    const paint = (frame: { points: number[]; ghost: boolean }, color: string, fill: boolean, width?: number) => {
      if (!frame.points.length) return;
      ctx.save();
      if (frame.ghost) ctx.globalAlpha = 0.35;
      drawSpectrum(ctx, w, h, frame.points, { color, fill, floor: -100, ceil: 6, width });
      ctx.restore();
    };
    paint(pre, "#8a90a8", true);
    paint(post, COLORS.cyan, true);
    paint(post, rgba(COLORS.cyan, 0.7), false, 1);

    const N = Math.max(200, Math.floor(w / 2));
    const freqs = Array.from({ length: N + 1 }, (_, i) => xToFreq((i / N) * w, w));
    const total = freqs.map(() => 0);

    bands.forEach((b, bi) => {
      if (!b.on) return;
      const curve = freqs.map((f) => bandDb(b, sr, f));
      curve.forEach((d, i) => (total[i] += d));
      const color = BAND_COLORS[bi % BAND_COLORS.length];
      ctx.beginPath();
      ctx.moveTo(0, Y(0));
      curve.forEach((d, i) => ctx.lineTo((i / N) * w, Y(clamp(d, -range * 1.5, range * 1.5))));
      ctx.lineTo(w, Y(0));
      ctx.closePath();
      ctx.fillStyle = rgba(color, bi === sel ? 0.22 : 0.08);
      ctx.fill();
      if (bi === sel) {
        ctx.strokeStyle = rgba(color, 0.8);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });

    ctx.save();
    ctx.shadowColor = rgba(COLORS.violet2, 0.9);
    ctx.shadowBlur = 10;
    ctx.beginPath();
    total.forEach((d, i) => (i ? ctx.lineTo((i / N) * w, Y(clamp(d, -range * 1.6, range * 1.6))) : ctx.moveTo(0, Y(d))));
    ctx.strokeStyle = "#f0ecff";
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();

    bands.forEach((b, bi) => {
      const x = X(b.freq);
      const y = hasGain(b.type) ? Y(b.gain) : Y(0);
      const color = BAND_COLORS[bi % BAND_COLORS.length];
      const isSel = bi === sel;
      ctx.beginPath();
      ctx.arc(x, y, isSel ? 9 : 7.5, 0, Math.PI * 2);
      ctx.fillStyle = b.on ? color : "#1a1e2c";
      ctx.strokeStyle = b.on ? "#fff" : rgba(color, 0.7);
      ctx.lineWidth = isSel ? 2 : 1.2;
      if (b.on) { ctx.shadowColor = color; ctx.shadowBlur = isSel ? 16 : 8; }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.fillStyle = b.on ? "#0a0b12" : rgba(color, 0.9);
      ctx.font = "bold 10px Inter, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(bi + 1), x, y + 0.5);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
      if (isSel && b.on && (b.type === EQ.bell || b.type === EQ.notch)) {
        // Q handles: the band's -3 dB width either side of the node.
        const half = Math.asinh(1 / (2 * b.q)) / Math.log(2);
        for (const dir of [-1, 1]) {
          const fx2 = b.freq * Math.pow(2, dir * half);
          ctx.strokeStyle = rgba(color, 0.7);
          ctx.beginPath();
          ctx.moveTo(X(fx2), y - 6);
          ctx.lineTo(X(fx2), y + 6);
          ctx.stroke();
        }
      }
    });

    if (hover && !drag.current) {
      ctx.fillStyle = "rgba(232,234,242,0.75)";
      ctx.font = "11px Inter, Segoe UI, sans-serif";
      const label = `${formatHz(xToFreq(hover.x, w))}  ${yToDb(hover.y, h, range).toFixed(1)} dB`;
      ctx.fillText(label, Math.min(hover.x + 10, w - 110), Math.max(14, hover.y - 10));
    }
  }, [fx.params, pre.points, pre.ghost, post.points, post.ghost, sel, range, hover, sr]);

  const hit = (x: number, y: number, w: number, h: number) => {
    let best = -1, bestD = 14;
    bands.forEach((b, i) => {
      const bx = freqToX(b.freq, w), by = hasGain(b.type) ? dbToY(b.gain, h, range) : dbToY(0, h, range);
      const d = Math.hypot(bx - x, by - y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };

  const setBand = (i: number, values: Partial<Record<keyof BandSpec, number>>) => {
    const s = specs[i];
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) {
      const pid = s[k as keyof BandSpec];
      if (typeof pid === "string" && v !== undefined) out[pid] = v;
    }
    fx.setMany(out);
  };

  const bandMenu = (e: React.MouseEvent, i: number) => {
    const s = specs[i], b = bands[i];
    const items: MenuItem[] = [];
    if (s.on) items.push({ label: b.on ? "Turn band off" : "Turn band on", icon: "power", run: () => setBand(i, { on: b.on ? 0 : 1 }) });
    if (s.type) {
      items.push({ separator: true });
      EQ_TYPES.forEach((name, ti) => items.push({ label: `${TYPE_GLYPH[ti]}  ${name}`, icon: b.type === ti ? "check" : undefined, run: () => setBand(i, { type: ti, on: 1 }) }));
    }
    if (s.slope && (b.type === EQ.lowCut || b.type === EQ.highCut)) {
      items.push({ separator: true });
      [12, 24, 36, 48].forEach((db, si) => items.push({ label: `${db} dB/oct`, icon: b.stages === si + 1 ? "check" : undefined, run: () => setBand(i, { slope: si }) }));
    }
    items.push({ separator: true }, { label: "Reset gain", icon: "undo", run: () => setBand(i, { gain: 0 }) });
    openMenu(e, items);
  };

  const s = specs[sel], b = bands[sel];
  const color = BAND_COLORS[sel % BAND_COLORS.length];

  return (
    <div className="fx-eq">
      <div className="fx-eq-top">
        <div className="fx-eq-graph">
          <canvas ref={ref} className="fx-canvas"
            onPointerDown={(e) => {
              const { x, y, w, h } = local(e);
              const i = hit(x, y, w, h);
              if (i < 0) return;
              setSelected(i);
              if (e.button !== 0) return;
              if (e.altKey && specs[i].on) { setBand(i, { on: bands[i].on ? 0 : 1 }); return; }
              (e.target as Element).setPointerCapture(e.pointerId);
              drag.current = { band: i, fine: e.shiftKey, x, y, f: bands[i].freq, g: bands[i].gain };
              if (specs[i].on && !bands[i].on) setBand(i, { on: 1 });
            }}
            onPointerMove={(e) => {
              const { x, y, w, h } = local(e);
              setHover({ x, y });
              const d = drag.current;
              if (!d) return;
              const fine = e.shiftKey ? 0.25 : 1;
              const fx0 = freqToX(d.f, w) + (x - d.x) * fine;
              const freq = clamp(xToFreq(fx0, w), 20, 20000);
              const gain = clamp(d.g + (yToDb(y, h, range) - yToDb(d.y, h, range)) * fine, -24, 24);
              setBand(d.band, hasGain(bands[d.band].type) ? { freq, gain } : { freq });
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerLeave={() => setHover(null)}
            onWheel={(e) => {
              const { x, y, w, h } = local(e);
              const i = hit(x, y, w, h);
              const target = i >= 0 ? i : sel;
              setSelected(target);
              setBand(target, { q: clamp(bands[target].q * Math.pow(1.12, -Math.sign(e.deltaY)), 0.1, 18) });
            }}
            onDoubleClick={(e) => {
              const { x, y, w, h } = local(e);
              const i = hit(x, y, w, h);
              if (i >= 0) { setBand(i, { gain: 0 }); return; }
              const free = specs.findIndex((sp, k) => sp.on && !bands[k].on);
              if (free < 0) return;
              setSelected(free);
              setBand(free, { on: 1, type: EQ.bell, freq: xToFreq(x, w), gain: clamp(yToDb(y, h, range), -24, 24), q: 1 });
            }}
            onContextMenu={(e) => {
              const { x, y, w, h } = local(e);
              const i = hit(x, y, w, h);
              if (i >= 0) { setSelected(i); bandMenu(e, i); } else e.preventDefault();
            }} />
          <div className="fx-eq-overlay">
            <div className="fx-seg small">
              {(["off", "post", "both"] as const).map((m) => (
                <button key={m} className={cx(analyser === m && "on")} disabled={classic} onClick={() => setAnalyser(m)}>
                  {m === "off" ? "Analyser off" : m === "post" ? "Post" : "Pre + post"}
                </button>
              ))}
            </div>
            <div className="fx-seg small">
              {[6, 12, 18, 24].map((r) => <button key={r} className={cx(range === r && "on")} onClick={() => setRange(r)}>±{r}</button>)}
            </div>
          </div>
          <div className="fx-hint">Drag a node to move it · scroll for width (Q) · double-click empty space to add a band · right-click for filter type · Alt-click to bypass a band</div>
        </div>
        {!classic && (
          <div className="fx-eq-side">
            <Meter db={t.inDb} label="In" height={210} />
            <Meter db={t.outDb} label="Out" height={210} color={COLORS.cyan} />
            <Knob fx={fx} pid="output" label="Output" size={44} />
          </div>
        )}
      </div>

      <div className="fx-eq-bands">
        {specs.map((sp, i) => {
          const bb = bands[i];
          const c = BAND_COLORS[i % BAND_COLORS.length];
          return (
            <button key={i} className={cx("fx-band-tab", i === sel && "on", !bb.on && "off")} style={{ ["--band" as string]: c }}
              onClick={() => setSelected(i)} onContextMenu={(e) => bandMenu(e, i)}>
              <span className="num">{i + 1}</span>
              <span className="glyph">{TYPE_GLYPH[bb.type]}</span>
              <span className="freq">{formatHz(bb.freq)}</span>
              {hasGain(bb.type) && <span className="gain">{bb.gain > 0 ? "+" : ""}{bb.gain.toFixed(1)}</span>}
              {sp.on && (
                <span className={cx("led", bb.on && "on")} role="switch" aria-checked={bb.on}
                  onClick={(e) => { e.stopPropagation(); setBand(i, { on: bb.on ? 0 : 1 }); }} />
              )}
            </button>
          );
        })}
      </div>

      <div className="fx-eq-detail" style={{ ["--band" as string]: color }}>
        <div className="fx-eq-detail-head">
          <span className="num">{sel + 1}</span>
          <b>Band {sel + 1}</b>
          {s.type ? (
            <div className="fx-seg small">
              {EQ_TYPES.map((name, ti) => (
                <button key={ti} className={cx(b.type === ti && "on")} title={name} onClick={() => setBand(sel, { type: ti, on: 1 })}>
                  <span className="glyph">{TYPE_GLYPH[ti]}</span> {name}
                </button>
              ))}
            </div>
          ) : (
            <span className="small faint">{EQ_TYPES[b.type]}</span>
          )}
        </div>
        <div className="fx-row">
          <Knob fx={fx} pid={s.freq} label="Frequency" color={color} size={54} />
          <Knob fx={fx} pid={s.gain} label="Gain" color={color} size={54} disabled={!hasGain(b.type)} />
          <Knob fx={fx} pid={s.q} label={b.type === EQ.lowShelf || b.type === EQ.highShelf ? "Slope (Q)" : "Width (Q)"} color={color} size={54} />
          {s.slope && (b.type === EQ.lowCut || b.type === EQ.highCut) && <Pick fx={fx} pid={s.slope} label="Steepness" />}
          {s.on && (
            <button className={cx("fx-toggle", b.on && "on")} onClick={() => setBand(sel, { on: b.on ? 0 : 1 })}>
              <span className="led" /> {b.on ? "Band on" : "Band off"}
            </button>
          )}
          <div className="grow" />
          <Presets fx={fx} presets={classic ? CLASSIC_EQ_PRESETS : EQ_PRESETS} />
        </div>
      </div>
    </div>
  );
}
