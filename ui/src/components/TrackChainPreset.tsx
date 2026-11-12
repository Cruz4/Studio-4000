import { useState } from "react";
import { rpc } from "../bridge";
import { toast, useStore } from "../store";
import { TRACK_CHAINS } from "../trackChains";
import { Modal } from "./ui";

export function TrackChainPreset() {
  const target = useStore((s) => s.chainPreset)!;
  const project = useStore((s) => s.project);
  const preset = TRACK_CHAINS.find((p) => p.id === target.id)!;
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = target.trackId === "master" ? "Master" : project?.tracks.find((t) => t.id === target.trackId)?.name ?? "Track";
  const close = () => useStore.setState({ chainPreset: null });
  async function apply() {
    setBusy(true); setError("");
    try {
      await rpc("chain.applyPreset", { ...target, name: preset.name, plugins: preset.plugins, replace });
      useStore.setState({ selectedTrack: target.trackId, bottom: "effects" });
      toast(`${preset.name} applied to ${name}`, "success"); close();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal title={preset.name} onClose={close} width={520} footer={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn accent" disabled={busy} onClick={() => void apply()}>Apply to {name}</button></>}>
    <div className="col" style={{ gap: 14 }}>
      <span className="small dim">{preset.category}</span><p style={{ margin: 0 }}>{preset.description}</p>
      <ol className="chain-preview">{preset.plugins.map((p, i) => <li key={i}><b>{p.name}</b><span>{p.setting}</span></li>)}</ol>
      <label className="field"><span>Existing effects</span><select className="input" value={replace ? "replace" : "append"} onChange={(e) => setReplace(e.target.value === "replace")}><option value="replace">Replace effects (keep the instrument and mixer controls)</option><option value="append">Append after the existing effects</option></select></label>
      <span className="small dim">Start with peaks around -12 dBFS, then adjust compressor and de-esser thresholds to your recording.{preset.plugins.some((p) => p.type === "s4000tune") && " Pitch correction starts chromatic; set the key and scale for your song."}</span>
      {error && <span className="small" role="alert">{error}</span>}
    </div>
  </Modal>;
}
