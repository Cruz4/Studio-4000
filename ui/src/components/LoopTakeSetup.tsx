import { useState } from "react";
import { rpc } from "../bridge";
import { act, useStore } from "../store";
import { formatBars, formatTime } from "../util";
import { Modal } from "./ui";

export function LoopTakeSetup() {
  const project = useStore((s) => s.project)!;
  const selected = useStore((s) => s.selectedTrack);
  const config = project.loopTakes;
  const recording = useStore((s) => s.transport.recording);
  const [count, setCount] = useState(config?.takeCount || 4);
  const [unlimited, setUnlimited] = useState(config?.takeCount === 0);
  const [mute, setMute] = useState(config?.mutePrevious ?? true);
  const audio = project.tracks.filter((t) => t.kind === "audio");
  const [source, setSource] = useState(audio.find((t) => t.id === selected)?.id ?? audio.find((t) => t.armed)?.id ?? audio[0]?.id ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = recording || (config?.active ?? false);
  const duration = project.loop[1] - project.loop[0];
  const validRange = project.loop[0] >= 0 && duration > 2;
  const close = () => useStore.setState({ loopTakeSetupOpen: false });

  async function save(enabled: boolean) {
    setBusy(true); setError("");
    try {
      const configure = { method: "recording.loopTakes.configure", params: enabled ? { enabled: true, takeCount: unlimited ? 0 : count, mutePrevious: mute } : { enabled: false } };
      await rpc("batch.run", { label: enabled ? "Arm loop takes" : "Turn off loop takes", calls: [
        ...(enabled ? project.tracks.filter((t) => t.armed || t.id === source).map((t) => ({ method: "track.arm", params: { id: t.id, armed: t.id === source } })) : []),
        configure,
      ] });
      if (enabled) useStore.setState({ selectedTrack: source });
      close();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <Modal title="Loop takes" onClose={close} width={480} footer={<>
    <button className="btn ghost" onClick={close}>Cancel</button>
    {active ? <button className="btn" onClick={async () => { await act("transport.stop"); close(); }}>Stop recording</button> : <>
      {config?.enabled && <button className="btn" disabled={busy} onClick={() => void save(false)}>Turn off loop takes</button>}
      <button className="btn accent" disabled={busy || !validRange || !source || !unlimited && (!Number.isInteger(count) || count < 1 || count > 99)} onClick={() => void save(true)}>{config?.enabled ? "Save loop takes" : "Arm loop takes"}</button>
    </>}
  </>}>
    <div className="col loop-take-setup" style={{ gap: 16 }}>
      <p className="small dim" style={{ margin: 0 }}>Set up and arm loop takes here. When you're ready, click Record or press R to start. Each pass gets a fresh track with the source's format, effects and routing.</p>
      {!active && config?.enabled && <div className="small dim">Loop takes are armed. The Record button shows LOOP. You can change these settings or turn the mode off before recording.</div>}
      <div className="loop-take-range">
        <b>{validRange ? `${formatBars(project.loop[0], project)} - ${formatBars(project.loop[1], project)}` : "Select a loop range"}</b>
        <span className="small dim">{validRange ? `${formatTime(duration)} per take` : "Use the Time tool (2) to highlight a range longer than 2 seconds in Tracks view."}</span>
        {!validRange && <button className="btn sm" disabled={active} onClick={() => { useStore.setState({ tool: "time", view: "tracks" }); close(); }}>Select a range</button>}
      </div>
      <label className="field"><span>Source audio track</span><select className="input" value={source} disabled={active} onChange={(e) => setSource(e.target.value)}>
        {!audio.length && <option value="">Add an audio track first</option>}
        {audio.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.channels === 1 ? "mono" : "stereo"})</option>)}
      </select></label>
      <label className="row"><input type="checkbox" checked={unlimited} disabled={active} onChange={(e) => setUnlimited(e.target.checked)} /> Keep going until I stop</label>
      {!unlimited && <label className="field"><span>Number of takes</span><input className="input" type="number" min={1} max={99} step={1} value={count} disabled={active} onChange={(e) => setCount(Number(e.target.value))} /><span className="small dim">Recording stops automatically after the last pass.</span></label>}
      <label className="col" style={{ gap: 6 }}><span className="row"><input type="checkbox" checked={mute} disabled={active} onChange={(e) => setMute(e.target.checked)} /> Mute previous takes as I go</span><span className="small dim">Leave this off to sing or rap over the earlier takes. The most recent take stays audible when you stop.</span></label>
      {active && <div className="small dim">{config?.active ? `Recording take ${config.take}${config.takeCount ? ` of ${config.takeCount}` : ""}. ` : ""}Stop recording to change these settings.</div>}
      {error && <div className="small" role="alert">{error}</div>}
    </div>
  </Modal>;
}
