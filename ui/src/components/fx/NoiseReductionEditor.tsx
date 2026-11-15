import { useMemo, useState } from "react";
import { rpc } from "../../bridge";
import { act, refreshProject, toast, useStore } from "../../store";
import { COLORS, Knob, Meter, Presets, Section, Toggle, useTelemetry } from "./core";
import type { Fx } from "./core";

export function NoiseReductionEditor({ fx, pluginId }: { fx: Fx; pluginId: string }) {
  const project = useStore((s) => s.project)!;
  const selected = useStore((s) => s.selectedClips);
  const [busy, setBusy] = useState(false);
  const [capturedCurve, setCapturedCurve] = useState<number[] | null>(null);
  const telemetry = useTelemetry(pluginId, {}, 12);
  const curve = capturedCurve ?? (telemetry.noisePrint as number[] | undefined) ?? [];
  const owner = project.tracks.map((track) => ({ track, clip: track.clips.find((c) => c.plugins?.some((p) => p.id === pluginId)) }))
    .find(({ track, clip }) => track.plugins.some((p) => p.id === pluginId) || !!clip);
  // A clip effect remains tied to its clip even if opening the window changes focus.
  // Track effects still follow the currently selected audio clip.
  const clip = useMemo(() => owner?.clip ?? project.tracks.flatMap((t) => t.clips).find((c) => selected.includes(c.id) && c.kind === "audio"), [owner?.clip, project, selected]);
  const host = owner?.track;
  const [start, end] = project.loop;
  const rangeOk = !!clip && end - start >= .1 && start < clip.end && end > clip.start;
  const points = curve.length ? curve.map((db, i) => `${(i / (curve.length - 1)) * 100},${100 - Math.max(0, Math.min(100, (db + 140) / 120 * 100))}`).join(" ") : "";

  const capture = async () => {
    if (!rangeOk || !clip) return toast("Select a noise-only time range over one audio clip first", "warning");
    setBusy(true);
    try {
      const learned = await rpc<number[]>("noise.capture", { id: pluginId, clipId: clip.id, start, end });
      setCapturedCurve(learned);
      toast(`Captured ${(end - start).toFixed(2)} seconds as the noise print`, "success");
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setBusy(false); }
  };

  const print = async (selectionOnly: boolean) => {
    if (!host) return;
    await act("track.bounce", { id: host.id, ...(selectionOnly && rangeOk ? { start, end, muteSource: false } : {}) });
    await refreshProject();
    toast(selectionOnly ? "Printed the selected cleaned range to a new track" : "Printed the cleaned track with Noise Reduction baked in", "success");
  };

  return <div className="noise-reduction-editor col">
    <Presets fx={fx} presets={[
      { name: "Gentle room tone", values: { amount: 35, reduce: 8, threshold: -2, noiseonly: 0 }, description: "Light broadband cleanup that preserves vocal detail." },
      { name: "Vocal booth cleanup", values: { amount: 55, reduce: 14, threshold: 0, noiseonly: 0 }, description: "Balanced starting point for steady preamp and room noise." },
      { name: "Laptop fan", values: { amount: 68, reduce: 18, threshold: 2, noiseonly: 0 }, description: "Stronger learned reduction for a constant fan spectrum." },
      { name: "Tape hiss", values: { amount: 48, reduce: 12, threshold: -1, noiseonly: 0 }, description: "Moderate high-frequency cleanup without stripping air." },
      { name: "Aggressive salvage", values: { amount: 82, reduce: 24, threshold: 3, noiseonly: 0 }, description: "For difficult recordings; check for watery artifacts." },
      { name: "Audit removed sound", values: { amount: 60, reduce: 16, threshold: 0, noiseonly: 1 }, description: "Outputs only the removed signal for careful tuning." },
    ]} />
    <Section title="Learn the noise">
      <div className="row wrap">
        <button className="btn accent" disabled={!rangeOk || busy} onClick={capture}>Capture Noise Print</button>
        <span className={rangeOk ? "small" : "small dim"}>{rangeOk && clip ? `${clip.name}: ${start.toFixed(2)}–${end.toFixed(2)} s` : "Select a noise-only range (0.1 seconds or longer) over one audio clip"}</span>
      </div>
    </Section>
    <div className="noise-print-graph">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Captured noise spectrum">
        {[20, 40, 60, 80].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} />)}
        {points && <polyline points={points} />}
      </svg>
      {!points && <div className="empty">Noise print undefined. Select noise, then capture it.</div>}
      <span className="noise-axis"><span>20 Hz</span><span>1 kHz</span><span>20 kHz</span></span>
    </div>
    <Section title="Live reduction" right={<span className="small dim">Changes are heard while you move them</span>}>
      <div className="row fx-controls spread">
        <Knob fx={fx} pid="amount" size={72} color={COLORS.cyan} />
        <Knob fx={fx} pid="reduce" size={72} color={COLORS.green} />
        <Knob fx={fx} pid="threshold" size={72} color={COLORS.amber} />
        <Meter db={Number(telemetry.reduction ?? 0)} label="Reduction %" gr min={0} height={92} color={COLORS.cyan} />
        <Toggle fx={fx} pid="noiseonly" label="Output Noise Only" />
      </div>
    </Section>
    <div className="row wrap"><span className="small dim grow">The editor time selection controls what you audition and can print. Use Output Noise Only and the effect power button for before/after.</span>
      <button className="btn" disabled={!rangeOk} onClick={async () => { await act("transport.setLoop", { start, end, enabled: true }); await act("transport.setPosition", { time: start }); await act("transport.play"); }}>Preview selection</button>
      <button className="btn" disabled={!host || !points || !rangeOk} onClick={() => print(true)}>Print Selected Range</button>
      <button className="btn" disabled={!host || !points} onClick={() => print(false)}>Print Full Track</button>
    </div>
  </div>;
}
