import { useEffect, useMemo, useState } from "react";
import { native } from "../bridge";
import { act, useStore } from "../store";
import { cx, formatTime } from "../util";
import { Icon, Modal, Spinner } from "./ui";

const TARGETS = [
  { id: "off", label: "Off", lufs: null, hint: "Keep the level of your mix" },
  { id: "stream", label: "Streaming", lufs: -14, hint: "Spotify, YouTube, Tidal" },
  { id: "apple", label: "Apple / podcast", lufs: -16, hint: "Apple Music, podcasts" },
  { id: "loud", label: "Loud", lufs: -9, hint: "Club, EDM masters" },
  { id: "broadcast", label: "Broadcast", lufs: -23, hint: "EBU R128 TV and radio" },
] as const;

type Range = "all" | "loop" | "selection";

export function ExportDialog() {
  const open = useStore((s) => s.exportOpen);
  const project = useStore((s) => s.project);
  const selectedClips = useStore((s) => s.selectedClips);
  const render = useStore((s) => s.render);
  const [what, setWhat] = useState<"mix" | "stems">("mix");
  const [format, setFormat] = useState<"wav" | "mp3" | "mp3wav" | "flac" | "ogg">("wav");
  const [bitDepth, setBitDepth] = useState(24);
  const [sampleRate, setSampleRate] = useState(0);
  const [target, setTarget] = useState<(typeof TARGETS)[number]["id"]>("stream");
  const [ceiling, setCeiling] = useState(-1);
  const [range, setRange] = useState<Range>("all");
  const [tail, setTail] = useState(2);
  const [name, setName] = useState("");
  const [tracks, setTracks] = useState<Set<string>>(new Set());

  const audioTracks = useMemo(() => project?.tracks.filter((t) => t.kind === "audio" || t.kind === "instrument") ?? [], [project]);
  useEffect(() => {
    if (open && project) {
      setName(project.name);
      setTracks(new Set(audioTracks.map((t) => t.id)));
      if (selectedClips.length) setRange("selection");
      else if (project.looping) setRange("loop");
      else setRange("all");
    }
  }, [open]);

  if (!open || !project) return null;
  const close = () => useStore.setState({ exportOpen: false });

  const sel = project.tracks.flatMap((t) => t.clips).filter((c) => selectedClips.includes(c.id));
  const span: [number, number] = range === "loop" ? project.loop
    : range === "selection" && sel.length ? [Math.min(...sel.map((c) => c.start)), Math.max(...sel.map((c) => c.end))]
    : [0, project.length];
  const t = TARGETS.find((x) => x.id === target)!;
  const rendering = render?.state === "rendering";

  const go = async () => {
    const ext = format === "mp3" ? "mp3" : format === "flac" ? "flac" : format === "ogg" ? "ogg" : "wav";
    const safe = (name.trim() || project.name || "Mix").replace(/[<>:"/\\|?*]/g, "").trim() || "Mix";
    const params: Record<string, unknown> = { what, format, name: safe, start: span[0], end: span[1], tail };
    if (format !== "ogg" && format !== "mp3") params.bitDepth = bitDepth;
    if (sampleRate) params.sampleRate = sampleRate;
    if (t.lufs !== null && what === "mix") { params.normalizeLufs = t.lufs; params.truePeakDb = ceiling; }
    if (what === "stems") {
      const picked = await native.pickFile({ mode: "folder", title: "Choose where to save the stems", dir: project.dir });
      if (!picked?.[0]) return;
      params.dir = picked[0];
      params.trackIds = [...tracks];
    } else {
      const picked = await native.pickFile({
        mode: "save",
        title: format === "mp3wav" ? "Export MP3 and WAV" : "Export mix",
        filters: `*.${ext}`,
        file: `${project.dir}\\${safe}.${ext}`,
      });
      if (!picked?.[0]) return;
      params.file = picked[0];
    }
    await act("export.render", params);
  };

  return (
    <Modal title="Export" onClose={close} width={640} footer={
      rendering ? (
        <>
          <div className="col grow" style={{ gap: 4 }}>
            <span className="small">{render.label} {render.steps && render.steps > 1 ? `(${render.step}/${render.steps})` : ""}</span>
            <div className="progress"><div style={{ width: `${(render.progress ?? 0) * 100}%` }} /></div>
          </div>
          <button className="btn" onClick={() => act("export.cancel", { job: render.job })}>Cancel</button>
        </>
      ) : (
        <>
          <span className="small faint grow">{what === "stems" ? "Next you'll choose the folder." : "Next you'll name the file and choose the folder."}</span>
          <button className="btn" onClick={close}>Close</button>
          <button className="btn primary" onClick={go} disabled={what === "stems" && !tracks.size}><Icon name="export" size={13} /> Export {what === "stems" ? `${tracks.size} stem${tracks.size === 1 ? "" : "s"}` : "mix"}</button>
        </>
      )
    }>
      <div className="row">
        {(["mix", "stems"] as const).map((w) => (
          <div key={w} className={cx("template grow", what === w && "on")} style={what === w ? { borderColor: "var(--violet)", boxShadow: "var(--glow)" } : undefined} onClick={() => setWhat(w)}>
            <div className="ti"><Icon name={w === "mix" ? "wave" : "layers"} size={16} /></div>
            <b>{w === "mix" ? "Stereo mix" : "Stems"}</b>
            <span>{w === "mix" ? "The full song through the master chain" : "One file per track, without the master chain, for mixing or mastering elsewhere"}</span>
          </div>
        ))}
      </div>

      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field grow"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Format</span>
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
            <option value="wav">WAV</option>
            <option value="mp3">MP3</option>
            <option value="mp3wav">MP3 and WAV</option>
            <option value="flac">FLAC (lossless, smaller)</option>
            <option value="ogg">OGG Vorbis</option>
          </select>
        </label>
        {format !== "ogg" && format !== "mp3" && (
          <label className="field"><span>Bit depth</span>
            <select className="input" value={bitDepth} onChange={(e) => setBitDepth(Number(e.target.value))}>
              <option value={16}>16-bit (dithered)</option><option value={24}>24-bit</option>{(format === "wav" || format === "mp3wav") && <option value={32}>32-bit float</option>}
            </select>
          </label>
        )}
        <label className="field"><span>Sample rate</span>
          <select className="input" value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value))}>
            <option value={0}>Session</option><option value={44100}>44.1 kHz</option><option value={48000}>48 kHz</option><option value={96000}>96 kHz</option>
          </select>
        </label>
      </div>
      {(format === "mp3" || format === "mp3wav") && (
        <span className="small faint">MP3 is 320 kbps stereo, or 192 kbps mono.{format === "mp3wav" ? " Both files use the name you choose, in the same folder." : ""}</span>
      )}

      <div className="col">
        <span className="section-title">Range</span>
        <div className="row">
          {(["all", "loop", "selection"] as const).map((r) => (
            <button key={r} className={cx("btn sm", range === r && "on")} disabled={r === "selection" && !sel.length} onClick={() => setRange(r)}>
              {r === "all" ? "Whole song" : r === "loop" ? "Loop range" : "Selected clips"}
            </button>
          ))}
          <span className="mono small faint grow" style={{ textAlign: "right" }}>{formatTime(span[0])} – {formatTime(span[1])}</span>
          <label className="row small dim">Tail <input className="input sm mono" type="number" min={0} max={30} step={0.5} style={{ width: 56 }} value={tail} onChange={(e) => setTail(Number(e.target.value))} /> s</label>
        </div>
      </div>

      {what === "mix" ? (
        <div className="col">
          <span className="section-title">Loudness</span>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {TARGETS.map((x) => (
              <button key={x.id} className={cx("btn sm", target === x.id && "on")} title={x.hint} onClick={() => setTarget(x.id)}>
                {x.label}{x.lufs !== null && <span className="mono faint"> {x.lufs}</span>}
              </button>
            ))}
          </div>
          {t.lufs !== null && (
            <div className="row small dim">
              <span className="grow">Normalised to {t.lufs} LUFS integrated, with a true-peak limiter at</span>
              <input className="input sm mono" type="number" step={0.1} max={0} min={-6} style={{ width: 64 }} value={ceiling} onChange={(e) => setCeiling(Number(e.target.value))} /> dBTP
            </div>
          )}
        </div>
      ) : (
        <div className="col">
          <div className="row">
            <span className="section-title grow">Tracks</span>
            <button className="btn sm ghost" onClick={() => setTracks(new Set(audioTracks.map((x) => x.id)))}>All</button>
            <button className="btn sm ghost" onClick={() => setTracks(new Set())}>None</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {audioTracks.map((tr) => (
              <label key={tr.id} className="row small" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={tracks.has(tr.id)} onChange={(e) => { const n = new Set(tracks); if (e.target.checked) n.add(tr.id); else n.delete(tr.id); setTracks(n); }} />
                <span style={{ width: 8, height: 8, borderRadius: 2, background: tr.colour }} />
                <span className="ellipsis">{tr.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {rendering && <div className="row small dim"><Spinner /> Rendering faster than real time. You can keep working.</div>}
    </Modal>
  );
}
