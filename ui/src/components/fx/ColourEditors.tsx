// Editors for tone colour: saturator and bit crusher.
import { COLORS, Knob, Meter, Presets, Section, Seg, rgba, useAnalyserFrame, useCanvas, useTelemetry, drawFreqGrid, drawSpectrum } from "./core";
import type { Fx } from "./core";
import { clamp, dbToGain, freqToX, saturate } from "./dsp";
import { CRUSHER_PRESETS, SATURATOR_PRESETS } from "./presets";

export function SaturatorEditor({ fx, pluginId }: { fx: Fx; pluginId: string }) {
  const t = useTelemetry(pluginId, { spectrum: true }, 20);
  const out = useAnalyserFrame(t.spectrumOut);
  const drive = dbToGain(fx.v("drive", 6));
  const type = fx.c("type");
  const mix = fx.v("mix", 100) / 100;
  const makeup = dbToGain(fx.v("output", 0)) / Math.sqrt(drive);

  const curve = useCanvas((ctx, w, h) => {
    ctx.fillStyle = "#090b14";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = COLORS.grid2;
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    ctx.strokeStyle = COLORS.grid;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, 0); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const x = -1 + (i / 200) * 2;
      const y = clamp(x + (saturate(type, x * drive) * makeup - x) * mix, -1.2, 1.2);
      const px = ((x + 1) / 2) * w, py = h / 2 - (y / 1.2) * (h / 2);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.save();
    ctx.strokeStyle = COLORS.orange;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = COLORS.orange;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = COLORS.label;
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    ctx.fillText("in →", w - 30, h / 2 - 4);
    ctx.fillText("out", w / 2 + 4, 12);
  }, [drive, type, mix, makeup]);

  const wave = useCanvas((ctx, w, h) => {
    ctx.fillStyle = "#090b14";
    ctx.fillRect(0, 0, w, h);
    const plot = (fn: (x: number) => number, color: string, width: number) => {
      ctx.beginPath();
      for (let i = 0; i <= w; i++) {
        const y = fn(Math.sin((i / w) * Math.PI * 4) * 0.9);
        if (i) ctx.lineTo(i, h / 2 - y * (h / 2 - 6)); else ctx.moveTo(i, h / 2 - y * (h / 2 - 6));
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    plot((x) => x, "#4b5168", 1);
    plot((x) => clamp(x + (saturate(type, x * drive) * makeup - x) * mix, -1, 1), COLORS.orange, 2);
  }, [drive, type, mix, makeup]);

  const spec = useCanvas((ctx, w, h) => {
    ctx.fillStyle = "#090b14";
    ctx.fillRect(0, 0, w, h);
    drawFreqGrid(ctx, w, h, [], (f) => freqToX(f, w));
    if (out.points.length) {
      ctx.save();
      if (out.ghost) ctx.globalAlpha = 0.35;
      drawSpectrum(ctx, w, h, out.points, { color: COLORS.orange, fill: true, floor: -100, ceil: 6 });
      drawSpectrum(ctx, w, h, out.points, { color: COLORS.orange, floor: -100, ceil: 6 });
      ctx.restore();
    }
  }, [out.points, out.ghost]);

  return (
    <div className="fx-layout">
      <div className="fx-row top">
        <Section title="Transfer curve" className="fx-curve-box"><canvas ref={curve.ref} className="fx-canvas square" /></Section>
        <div className="col grow" style={{ gap: 10 }}>
          <Section title="A sine wave through it"><canvas ref={wave.ref} className="fx-canvas" style={{ height: 84 }} /></Section>
          <Section title="Output spectrum: the added harmonics"><canvas ref={spec.ref} className="fx-canvas" style={{ height: 96 }} /></Section>
        </div>
        <div className="fx-meters"><Meter db={t.inDb} label="In" height={200} /><Meter db={t.outDb} label="Out" height={200} color={COLORS.orange} /></div>
      </div>
      <div className="fx-row knobs">
        <Seg fx={fx} pid="type" label="Character" />
        <Knob fx={fx} pid="drive" color={COLORS.orange} size={64} />
        <Knob fx={fx} pid="tone" color={COLORS.amber} format={(p) => (Math.abs(p.value) < 1 ? "Neutral" : p.value < 0 ? `Darker ${(-p.value).toFixed(0)}%` : `Brighter ${p.value.toFixed(0)}%`)} />
        <Knob fx={fx} pid="output" color={COLORS.cyan} />
        <Knob fx={fx} pid="mix" label="Dry / wet" color={COLORS.green} />
      </div>
      <Presets fx={fx} presets={SATURATOR_PRESETS} />
    </div>
  );
}

export function CrusherEditor({ fx, pluginId }: { fx: Fx; pluginId: string }) {
  const t = useTelemetry(pluginId, {}, 15);
  const bits = fx.v("bits", 8), factor = Math.max(1, fx.v("downsample", 4)), mix = fx.v("mix", 100) / 100;
  const sr = t.sampleRate || 48000;

  const { ref } = useCanvas((ctx, w, h) => {
    ctx.fillStyle = "#090b14";
    ctx.fillRect(0, 0, w, h);
    const steps = Math.pow(2, bits - 1);
    const n = 240;
    for (let lv = -steps; lv <= steps && steps <= 64; lv++) {
      const y = h / 2 - (lv / steps) * (h / 2 - 6);
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    const src = (i: number) => Math.sin((i / n) * Math.PI * 2 * 1.5) * 0.92;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const y = h / 2 - src(i) * (h / 2 - 6);
      if (i) ctx.lineTo((i / n) * w, y); else ctx.moveTo(0, y);
    }
    ctx.strokeStyle = "#4b5168";
    ctx.lineWidth = 1;
    ctx.stroke();
    // Each sample is held for `factor` samples and rounded to the bit depth.
    const hold = Math.max(1, Math.round(factor));
    ctx.beginPath();
    let held = 0;
    for (let i = 0; i <= n; i++) {
      if (i % hold === 0) held = Math.round(src(i) * steps) / steps;
      const y = h / 2 - (src(i) + (held - src(i)) * mix) * (h / 2 - 6);
      if (i) ctx.lineTo((i / n) * w, y); else ctx.moveTo(0, y);
    }
    ctx.save();
    ctx.strokeStyle = COLORS.green;
    ctx.lineWidth = 2;
    ctx.shadowColor = COLORS.green;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = rgba(COLORS.green, 0.9);
    ctx.font = "bold 12px Inter, Segoe UI, sans-serif";
    ctx.fillText(`${bits.toFixed(0)}-bit · ${(sr / factor / 1000).toFixed(1)} kHz`, 10, 18);
  }, [bits, factor, mix, sr]);

  return (
    <div className="fx-layout">
      <div className="fx-row top">
        <Section title="Waveform" className="grow"><canvas ref={ref} className="fx-canvas" style={{ height: 200 }} /></Section>
        <div className="fx-meters"><Meter db={t.inDb} label="In" height={200} /><Meter db={t.outDb} label="Out" height={200} color={COLORS.green} /></div>
      </div>
      <div className="fx-row knobs">
        <Knob fx={fx} pid="bits" color={COLORS.green} size={64} format={(p) => `${p.value.toFixed(1)} bits`} />
        <Knob fx={fx} pid="downsample" label="Downsample" color={COLORS.cyan} size={64} format={(p) => `${(sr / Math.max(1, p.value) / 1000).toFixed(1)} kHz`} />
        <Knob fx={fx} pid="mix" label="Dry / wet" color={COLORS.violet2} />
        <Knob fx={fx} pid="output" color={COLORS.amber} />
      </div>
      <Presets fx={fx} presets={CRUSHER_PRESETS} />
    </div>
  );
}
