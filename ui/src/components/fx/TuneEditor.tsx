// Pitch correction editor: live pitch graph over the scale, tuning needle, key keyboard and retune controls.
import { cx } from "../../util";
import { COLORS, Knob, Meter, Pick, Presets, Section, rgba, useCanvas, useHistory, useTelemetry } from "./core";
import type { Fx } from "./core";
import { NOTE_NAMES, SCALE_MASKS, clamp, noteName } from "./dsp";
import { TUNE_PRESETS } from "./presets";

const BLACK = new Set([1, 3, 6, 8, 10]);

export function TuneEditor({ fx, pluginId }: { fx: Fx; pluginId: string }) {
  const t = useTelemetry(pluginId, {}, 30);
  const key = fx.c("key"), scale = fx.c("scale");
  const mask = SCALE_MASKS[scale] ?? 0xfff;
  const inScale = (n: number) => (mask & (1 << ((((n - key) % 12) + 12) % 12))) !== 0;
  const detected = (t.detectedNote as number | undefined) ?? 0;
  const target = (t.targetNote as number | undefined) ?? 0;
  const corr = (t.correctionCents as number | undefined) ?? 0;
  const voiced = detected > 0;
  const len = 240;
  const hIn = useHistory(t, () => (voiced ? detected : 0), len, 0);
  const hOut = useHistory(t, () => (voiced ? detected + corr / 100 : 0), len, 0);
  const hTarget = useHistory(t, () => (voiced ? target : 0), len, 0);
  const cents = voiced ? (detected - Math.round(detected)) * 100 : 0;

  const recent = hIn.filter((n) => n > 0);
  const centre = recent.length ? recent.slice(-60).reduce((a, b) => a + b, 0) / Math.min(60, recent.length) : 60;
  const lo = Math.round(centre) - 7, hi = Math.round(centre) + 7;

  const { ref } = useCanvas((ctx, w, h) => {
    const labelW = 34;
    const Y = (n: number) => h - ((n - lo + 0.5) / (hi - lo + 1)) * h;
    const laneH = h / (hi - lo + 1);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, w, h);
    for (let n = lo; n <= hi; n++) {
      const y = Y(n) - laneH / 2;
      const pc = ((n % 12) + 12) % 12;
      const isRoot = pc === key;
      ctx.fillStyle = inScale(n) ? (isRoot ? rgba(COLORS.violet, 0.22) : rgba(COLORS.violet, 0.1)) : COLORS.laneOff;
      ctx.fillRect(labelW, y, w - labelW, laneH - 1);
      ctx.fillStyle = BLACK.has(pc) ? COLORS.laneBlack : COLORS.laneWhite;
      ctx.fillRect(0, y, labelW - 2, laneH - 1);
      ctx.fillStyle = inScale(n) ? (isRoot ? COLORS.violet2 : COLORS.noteOn) : COLORS.noteOff;
      ctx.font = `${isRoot ? "bold " : ""}10px Inter, Segoe UI, sans-serif`;
      ctx.fillText(noteName(n), 4, y + laneH / 2 + 3.5);
    }
    const step = (w - labelW) / (len - 1);
    const plot = (vals: number[], color: string, width: number, steps = false) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let pen = false;
      vals.forEach((n, i) => {
        if (n <= 0 || n < lo - 1 || n > hi + 1) { pen = false; return; }
        const x = labelW + i * step, y = Y(n);
        if (!pen) { ctx.moveTo(x, y); pen = true; } else if (steps) { ctx.lineTo(x, Y(vals[i - 1] > 0 ? vals[i - 1] : n)); ctx.lineTo(x, y); } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    plot(hTarget, rgba(COLORS.violet2, 0.55), 6, true);
    plot(hIn, rgba(COLORS.amber, 0.85), 1.4);
    ctx.save();
    ctx.shadowColor = COLORS.cyan;
    ctx.shadowBlur = 8;
    plot(hOut, COLORS.cyan, 2.4);
    ctx.restore();
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    ctx.fillStyle = COLORS.amber; ctx.fillText("● sung pitch", w - 220, 14);
    ctx.fillStyle = COLORS.cyan; ctx.fillText("● corrected", w - 145, 14);
    ctx.fillStyle = COLORS.violet2; ctx.fillText("▬ target note", w - 80, 14);
  }, [hIn, hOut, hTarget, lo, hi, key, mask]);

  const needle = useCanvas((ctx, w, h) => {
    const cxp = w / 2, cy = h - 8, r = Math.min(w / 2 - 10, h - 16);
    ctx.lineWidth = 6;
    for (let c = -50; c < 50; c += 2) {
      const a0 = Math.PI * (1 + (c + 50) / 100), a1 = Math.PI * (1 + (c + 52) / 100);
      const d = Math.abs(c + 1);
      ctx.strokeStyle = d < 6 ? COLORS.green : d < 20 ? COLORS.amber : COLORS.red;
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(cxp, cy, r, a0, a1); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (voiced) {
      const a = Math.PI * (1 + (clamp(cents, -50, 50) + 50) / 100);
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = COLORS.cyan;
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(cxp, cy); ctx.lineTo(cxp + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2)); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = COLORS.label;
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    ctx.fillText("-50", 2, h - 2);
    ctx.fillText("+50", w - 22, h - 2);
    ctx.fillText("0", cxp - 3, 10);
  }, [cents, voiced]);

  return (
    <div className="fx-layout">
      <div className="fx-row top">
        <Section title="Pitch" className="grow"><canvas ref={ref} className="fx-canvas" style={{ height: 230 }} /></Section>
        <div className="fx-tune-readout">
          <div className={cx("fx-note-name", voiced && "on")}>{voiced ? noteName(detected) : "–"}</div>
          <div className="small faint">{voiced ? `${cents > 0 ? "+" : ""}${cents.toFixed(0)} cents` : "No pitch detected"}</div>
          <canvas ref={needle.ref} className="fx-canvas" style={{ height: 70, background: "transparent" }} />
          <div className="small">{voiced ? <>Target <b style={{ color: COLORS.violet2 }}>{noteName(target)}</b></> : " "}</div>
          <div className="small faint">{voiced && Math.abs(corr) > 0.5 ? `Shifting ${corr > 0 ? "+" : ""}${corr.toFixed(0)} cents` : " "}</div>
        </div>
        <div className="fx-meters"><Meter db={t.inDb} label="In" height={230} /><Meter db={t.outDb} label="Out" height={230} color={COLORS.cyan} /></div>
      </div>

      <div className="fx-row">
        <Section title="Key: click a note to set the root">
          <div className="fx-keyboard">
            {NOTE_NAMES.map((n, i) => (
              <button key={n} className={cx("k", BLACK.has(i) ? "black" : "white", inScale(i + 60) && "in", i === key && "root")}
                onClick={() => fx.set("key", i)} title={`${n}${inScale(i + 60) ? " (in scale)" : ""}`}>
                <span>{n}</span>
              </button>
            ))}
          </div>
        </Section>
        <div className="col" style={{ gap: 8, minWidth: 180 }}>
          <Pick fx={fx} pid="scale" label="Scale" />
          <span className="small faint">{NOTE_NAMES[key]} {fx.get("scale")?.options?.[scale]?.label ?? ""}: {NOTE_NAMES.filter((_, i) => inScale(i + 60)).join(" ")}</span>
        </div>
      </div>

      <div className="fx-row knobs">
        <Knob fx={fx} pid="speed" label="Retune speed" color={COLORS.cyan} size={64}
          format={(p) => (p.value <= 2 ? "Instant (robotic)" : p.value > 150 ? `${p.value.toFixed(0)} ms · natural` : `${p.value.toFixed(0)} ms`)} />
        <Knob fx={fx} pid="amount" label="Correction amount" color={COLORS.violet2} size={56} />
        <Knob fx={fx} pid="tolerance" label="Tolerance" color={COLORS.amber} />
        <Knob fx={fx} pid="mix" label="Dry / wet" color={COLORS.green} />
        <div className="fx-note">Retune speed sets how fast notes snap to the scale: 0 ms gives the hard, robotic effect, 50–150 ms sounds natural. Tolerance leaves notes alone when they are already within that many cents.</div>
      </div>
      <Presets fx={fx} presets={TUNE_PRESETS} />
    </div>
  );
}
