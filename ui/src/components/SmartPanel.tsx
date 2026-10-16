import { useState } from "react";
import { rpc } from "../bridge";
import { act, toast, useStore } from "../store";
import type { Analysis, Plan } from "../types";
import { cx, formatDb } from "../util";
import { Icon, Spinner } from "./ui";

const TARGETS = [
  { id: "stream", label: "Streaming (Spotify, YouTube)", lufs: -14, ceiling: -1 },
  { id: "apple", label: "Apple Music", lufs: -16, ceiling: -1 },
  { id: "podcast", label: "Podcast", lufs: -16, ceiling: -1.5 },
  { id: "broadcast", label: "Broadcast (EBU R128)", lufs: -23, ceiling: -1 },
  { id: "club", label: "Club / loud master", lufs: -9, ceiling: -0.5 },
];

const ROLES = ["vocal", "dialogue", "drums", "bass", "music", "return"];

type PlanKind = "mix" | "gainStage" | "duck" | "master";

export function SmartPanel() {
  const project = useStore((s) => s.project)!;
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [target, setTarget] = useState(TARGETS[0]);
  const [trackLufs, setTrackLufs] = useState(-18);
  const [opts, setOpts] = useState({ balance: true, duck: true, master: true });
  const [plan, setPlan] = useState<{ kind: PlanKind; params: Record<string, unknown>; plan: Plan } | null>(null);
  const [duckTarget, setDuckTarget] = useState<string>("");
  const [duckKeys, setDuckKeys] = useState<string[]>([]);
  const [depth, setDepth] = useState(6);

  const audioTracks = project.tracks.filter((t) => t.kind === "audio" || t.kind === "instrument");

  const run = async <T,>(label: string, fn: () => Promise<T>) => {
    setBusy(label);
    try { return await fn(); } catch (e) { toast((e as Error).message, "error"); return undefined; } finally { setBusy(null); }
  };

  const analyze = () => run("analyze", async () => setAnalysis(await rpc<Analysis>("smart.analyze", { master: true })));

  const preview = (kind: PlanKind, params: Record<string, unknown>) =>
    run(kind, async () => {
      const p = await rpc<Plan>(`smart.${kind}`, params);
      setPlan({ kind, params, plan: p });
    });

  const apply = () => plan && run("apply", async () => {
    const r = await rpc<Plan>(`smart.${plan.kind}`, { ...plan.params, apply: true });
    toast(r.summary, "success", { action: { label: "Undo", run: () => act("edit.undo") } });
    setPlan(null);
    analyze();
  });

  const mixParams = { trackLufs, masterLufs: target.lufs, ceilingDb: target.ceiling, ...opts };

  const fix = (method?: string) => {
    if (!method) return;
    if (method === "smart.master") preview("master", { targetLufs: target.lufs, ceilingDb: target.ceiling });
    else if (method === "smart.gainStage") preview("gainStage", { targetLufs: trackLufs });
    else if (method === "smart.mix") preview("mix", mixParams);
    else if (method === "smart.duck") preview("duck", { targetTrackId: duckTarget, keyTrackIds: duckKeys, depthDb: depth });
  };

  const m = analysis?.master;

  return (
    <div className="smart">
      <div className="card">
        <div className="row">
          <Icon name="headphones" />
          <b className="grow">Mix health</b>
          <button className="btn sm primary" onClick={analyze} disabled={!!busy}>{busy === "analyze" ? <Spinner /> : <Icon name="search" size={12} />} Analyse mix</button>
        </div>
        {!analysis && <span className="dim small">Renders the session offline and measures loudness (LUFS), peaks, dynamics (LRA), stereo correlation and low-end balance for the master and every track. Nothing changes until you apply a fix.</span>}
        {m && (
          <div className="row" style={{ flexWrap: "wrap" }}>
            <div className="stat"><b style={{ color: Math.abs(m.lufs - target.lufs) > 1.5 ? "var(--amber)" : "var(--green)" }}>{m.lufs.toFixed(1)}</b><span>LUFS integrated</span></div>
            <div className="stat"><b style={{ color: m.peakDb > -1 ? "var(--red)" : undefined }}>{formatDb(m.peakDb)}</b><span>Peak dBFS</span></div>
            <div className="stat"><b>{m.lra.toFixed(1)}</b><span>LRA (LU)</span></div>
            <div className="stat"><b style={{ color: m.correlation < 0.2 ? "var(--amber)" : undefined }}>{m.correlation.toFixed(2)}</b><span>Correlation</span></div>
            <div className="stat"><b>{Math.round(m.lowEndRatio * 100)}%</b><span>Low end &lt;150 Hz</span></div>
          </div>
        )}
        {analysis && (
          <div className="col" style={{ gap: 6 }}>
            {analysis.issues.map((i, k) => (
              <div key={k} className="issue">
                <span className="ic" style={{ color: i.level === "error" ? "var(--red)" : i.level === "warning" ? "var(--amber)" : i.level === "ok" ? "var(--green)" : "var(--cyan)" }}>
                  <Icon name={i.level === "ok" ? "check" : i.level === "info" ? "info" : "alert"} size={14} />
                </span>
                <span className="grow small">{i.message}</span>
                {i.fix && <button className="btn sm" onClick={() => fix(i.fix)}>Fix…</button>}
              </div>
            ))}
            {!analysis.issues.length && <div className="issue"><Icon name="check" size={14} /><span className="small">No problems found.</span></div>}
          </div>
        )}
        {analysis && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr className="faint" style={{ textAlign: "left" }}><th>Track</th><th>Role</th><th style={{ textAlign: "right" }}>LUFS</th><th style={{ textAlign: "right" }}>Peak</th><th style={{ textAlign: "right" }}>LRA</th></tr></thead>
            <tbody>
              {analysis.tracks.map((t) => (
                <tr key={t.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td className="ellipsis" style={{ maxWidth: 140, padding: "4px 0" }}>{t.name}</td>
                  <td>
                    <select className="input sm" value={t.role} onChange={(e) => { act("track.set", { id: t.id, role: e.target.value }); setAnalysis({ ...analysis, tracks: analysis.tracks.map((x) => (x.id === t.id ? { ...x, role: e.target.value } : x)) }); }}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="mono" style={{ textAlign: "right" }}>{t.hasAudio && t.lufs !== undefined ? t.lufs.toFixed(1) : "–"}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{t.hasAudio ? formatDb(t.peakDb) : "–"}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{t.hasAudio && t.lra !== undefined ? t.lra.toFixed(1) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="row"><Icon name="sparkles" /><b className="grow">Smart Mix</b>{busy && busy !== "analyze" && <Spinner />}</div>
        <span className="dim small">A starting point in one click: gain-stage every track, balance by role (vocals up front, music under), duck music under speech, then master to your loudness target. It's one undo step.</span>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <label className="field grow"><span>Loudness target</span>
            <select className="input sm" value={target.id} onChange={(e) => setTarget(TARGETS.find((t) => t.id === e.target.value)!)}>
              {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label} · {t.lufs} LUFS</option>)}
            </select>
          </label>
          <label className="field" style={{ width: 110 }}><span>Track level</span>
            <select className="input sm" value={trackLufs} onChange={(e) => setTrackLufs(+e.target.value)}>
              {[-14, -16, -18, -20, -23].map((v) => <option key={v} value={v}>{v} LUFS</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          {(["balance", "duck", "master"] as const).map((k) => (
            <button key={k} className={cx("btn sm", opts[k] && "on")} onClick={() => setOpts({ ...opts, [k]: !opts[k] })}>
              {opts[k] && <Icon name="check" size={11} />} {k === "balance" ? "Balance" : k === "duck" ? "Duck music" : "Master"}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn primary grow" disabled={!!busy} onClick={() => preview("mix", mixParams)}><Icon name="wand" size={14} /> Preview Smart Mix</button>
          <button className="btn" disabled={!!busy} onClick={() => preview("gainStage", { targetLufs: trackLufs })}>Gain stage</button>
          <button className="btn" disabled={!!busy} onClick={() => preview("master", { targetLufs: target.lufs, ceilingDb: target.ceiling })}>Master</button>
        </div>

        <div className="section-title" style={{ marginTop: 6 }}>Auto-duck</div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <label className="field grow"><span>Lower this track</span>
            <select className="input sm" value={duckTarget} onChange={(e) => setDuckTarget(e.target.value)}>
              <option value="">Choose…</option>
              {audioTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="field" style={{ width: 90 }}><span>Depth</span>
            <select className="input sm" value={depth} onChange={(e) => setDepth(+e.target.value)}>{[3, 6, 9, 12, 18].map((d) => <option key={d} value={d}>{d} dB</option>)}</select>
          </label>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
          <span className="small faint">…whenever these play:</span>
          {audioTracks.filter((t) => t.id !== duckTarget).map((t) => (
            <button key={t.id} className={cx("btn sm", duckKeys.includes(t.id) && "on")} onClick={() => setDuckKeys(duckKeys.includes(t.id) ? duckKeys.filter((x) => x !== t.id) : [...duckKeys, t.id])}>{t.name}</button>
          ))}
        </div>
        <button className="btn" disabled={!duckTarget || !duckKeys.length || !!busy} onClick={() => preview("duck", { targetTrackId: duckTarget, keyTrackIds: duckKeys, depthDb: depth })}>Preview ducking</button>

        {plan && (
          <div className="plan">
            <div className="row"><Icon name="sparkles" size={14} /><b className="grow">{plan.plan.summary}</b></div>
            {plan.plan.steps && <ol>{plan.plan.steps.map((s, i) => <li key={i}><b style={{ color: "var(--text)" }}>{s.title}:</b> {s.summary}</li>)}</ol>}
            {!plan.plan.steps && plan.plan.details && plan.plan.details.length > 0 && (
              <ol>{(plan.plan.details as Record<string, unknown>[]).slice(0, 12).map((d, i) => <li key={i}>{describeDetail(d)}</li>)}</ol>
            )}
            <span className="small faint">{plan.plan.calls.length} change(s) · applied as one undo step</span>
            <div className="row">
              <button className="btn primary grow" disabled={!plan.plan.calls.length || !!busy} onClick={apply}>{busy === "apply" ? <Spinner /> : <Icon name="check" size={13} />} Apply</button>
              <button className="btn" onClick={() => setPlan(null)}>Discard</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function describeDetail(d: Record<string, unknown>) {
  const n = (v: unknown) => Number(v).toFixed(1);
  if ("start" in d && "end" in d) return `Duck ${n(d.start)} s – ${n(d.end)} s`;
  if ("changeDb" in d) return `${d.name}: ${Number(d.changeDb) > 0 ? "+" : ""}${n(d.changeDb)} dB clip gain (${n(d.before)} → ${n(d.after)} LUFS)`;
  if ("measuredLufs" in d) return `Master ${n(d.measuredLufs)} → ${d.targetLufs} LUFS: limiter +${n(d.limiterGainDb)} dB, ceiling ${d.ceilingDb} dB`;
  if ("role" in d) return `${d.name} (${d.role}): fader ${formatDb(Number(d.volumeDb))} dB`;
  return Object.entries(d).map(([k, v]) => `${k}: ${typeof v === "number" ? v.toFixed(2) : String(v)}`).join(", ");
}
