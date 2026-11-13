import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "../bridge";
import { act, live, openPlugin, refreshProject, selectTrack, toast, useStore } from "../store";
import type { Plugin } from "../types";
import { Icon } from "./ui";

const BINS = 160;
const PROFILE_KEY = "studio4000.referenceProfiles.v1";
const FREQS = [60, 120, 250, 500, 1000, 2500, 6000, 12000];

interface Profile { id: string; name: string; spectrum: number[]; width: number; created: string }

function storedProfiles(): Profile[] {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "[]") as Profile[]; } catch { return []; }
}

function saveProfiles(items: Profile[]) { localStorage.setItem(PROFILE_KEY, JSON.stringify(items)); }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function wavBlob(chunks: Float32Array[][], sampleRate: number) {
  const frames = chunks.reduce((n, c) => n + (c[0]?.length || 0), 0);
  const out = new ArrayBuffer(44 + frames * 4);
  const v = new DataView(out);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF"); v.setUint32(4, 36 + frames * 4, true); text(8, "WAVE"); text(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  text(36, "data"); v.setUint32(40, frames * 4, true);
  let p = 44;
  for (const c of chunks) for (let i = 0; i < c[0].length; i++) {
    v.setInt16(p, clamp(c[0][i], -1, 1) * 32767, true); p += 2;
    v.setInt16(p, clamp((c[1] || c[0])[i], -1, 1) * 32767, true); p += 2;
  }
  return new Blob([out], { type: "audio/wav" });
}

async function blobBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function spectrumFrom(analyser: AnalyserNode, target: Float32Array) {
  const raw = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(raw);
  const nyquist = analyser.context.sampleRate / 2;
  for (let i = 0; i < target.length; i++) {
    const hz = 20 * Math.pow(1000, (i + .5) / target.length);
    target[i] = raw[clamp(Math.round((hz / nyquist) * raw.length), 0, raw.length - 1)] || -100;
  }
}

function drawSpectrum(ctx: CanvasRenderingContext2D, w: number, h: number, values: ArrayLike<number>, color: string, fill = false) {
  ctx.beginPath();
  for (let i = 0; i < values.length; i++) {
    const x = (i / Math.max(1, values.length - 1)) * w;
    const y = h - clamp((Number(values[i]) + 100) / 106, 0, 1) * h;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  if (fill) { ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); }
  else { ctx.strokeStyle = color; ctx.lineWidth = 1.7; ctx.stroke(); }
}

export function ReferenceTool() {
  const open = useStore((s) => s.referenceOpen);
  const project = useStore((s) => s.project)!;
  const selectedTrack = useStore((s) => s.selectedTrack);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [sourceName, setSourceName] = useState("No Windows source selected");
  const [recording, setRecording] = useState(false);
  const [masterPlugin, setMasterPlugin] = useState<string | null>(null);
  const [masterSpec, setMasterSpec] = useState<number[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>(storedProfiles);
  const [profileId, setProfileId] = useState("");
  const [targetTrack, setTargetTrack] = useState(selectedTrack ?? "");
  const [width, setWidth] = useState(0);
  const [pos, setPos] = useState(() => ({ x: Math.max(12, (window.innerWidth - 980) / 2), y: Math.max(56, window.innerHeight * .1) }));
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<HTMLCanvasElement>(null);
  const audio = useRef<{ ctx: AudioContext; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; left: AnalyserNode; right: AnalyserNode; processor: ScriptProcessorNode; sink: GainNode } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const masterSpecRef = useRef<number[]>([]);
  const profileRef = useRef<Profile | null>(null);
  const ext = useRef(new Float32Array(BINS).fill(-100));
  const average = useRef(new Float64Array(BINS));
  const frames = useRef(0);
  const captured = useRef<Float32Array[][]>([]);
  const recordingStart = useRef(0);
  const raf = useRef(0);

  const disconnect = useCallback(() => {
    cancelAnimationFrame(raf.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audio.current?.ctx.close();
    audio.current = null; setStream(null); setRecording(false); setSourceName("No Windows source selected");
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);
  useEffect(() => { profileRef.current = profiles.find((p) => p.id === profileId) ?? null; }, [profiles, profileId]);
  useEffect(() => {
    if (project.tracks.some((t) => t.id === selectedTrack && (t.kind === "audio" || t.kind === "instrument"))) setTargetTrack(selectedTrack!);
  }, [selectedTrack, project.tracks]);

  useEffect(() => {
    if (!masterPlugin) return;
    const timer = window.setInterval(async () => {
      const t = await rpc<{ spectrumOut?: number[] }>("plugin.telemetry", { id: masterPlugin, spectrum: true }).catch(() => null);
      if (t?.spectrumOut?.length) { masterSpecRef.current = t.spectrumOut; setMasterSpec(t.spectrumOut); }
    }, 120);
    return () => clearInterval(timer);
  }, [masterPlugin]);

  const render = () => {
    const a = audio.current;
    if (a) {
      spectrumFrom(a.analyser, ext.current);
      frames.current++;
      for (let i = 0; i < BINS; i++) average.current[i] += (ext.current[i] - average.current[i]) / Math.min(frames.current, 600);
    }
    const c = canvas.current, f = field.current;
    if (c) {
      const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const x = c.getContext("2d")!; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
      x.fillStyle = "#111521"; x.fillRect(0, 0, w, h); x.strokeStyle = "rgba(255,255,255,.09)"; x.lineWidth = 1;
      for (let i = 1; i < 5; i++) { x.beginPath(); x.moveTo(0, h * i / 5); x.lineTo(w, h * i / 5); x.stroke(); }
      if (a) { drawSpectrum(x, w, h, ext.current, "rgba(41,193,255,.18)", true); drawSpectrum(x, w, h, ext.current, "#29c1ff"); }
      if (masterSpecRef.current.length) drawSpectrum(x, w, h, masterSpecRef.current, "#ed4bff");
      if (profileRef.current) drawSpectrum(x, w, h, profileRef.current.spectrum, "#ffc857");
    }
    if (f) {
      const dpr = devicePixelRatio || 1, w = f.clientWidth, h = f.clientHeight;
      if (f.width !== w * dpr || f.height !== h * dpr) { f.width = w * dpr; f.height = h * dpr; }
      const x = f.getContext("2d")!; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.fillStyle = "#111521"; x.fillRect(0, 0, w, h);
      x.strokeStyle = "rgba(255,255,255,.14)"; x.beginPath(); x.moveTo(w / 2, 8); x.lineTo(w / 2, h - 8); x.moveTo(8, h / 2); x.lineTo(w - 8, h / 2); x.stroke();
      if (a) {
        const l = new Float32Array(512), r = new Float32Array(512); a.left.getFloatTimeDomainData(l); a.right.getFloatTimeDomainData(r);
        let side = 0, mid = 0; x.fillStyle = "rgba(41,193,255,.55)";
        for (let i = 0; i < l.length; i += 3) { const m = (l[i] + r[i]) * .5, s = (l[i] - r[i]) * .5; mid += m * m; side += s * s; x.fillRect(w / 2 + s * w * .9, h / 2 - m * h * .9, 1.5, 1.5); }
        if (frames.current % 10 === 0) setWidth(Math.round(clamp(Math.sqrt(side / Math.max(mid, 1e-9)) * 100, 0, 200)));
      }
    }
    raf.current = requestAnimationFrame(render);
  };

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    if (open || stream) raf.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf.current);
  }, [open, stream, profileId, masterPlugin]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseSource = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) return toast("This Windows/WebView build cannot capture another app. Update WebView2 and try again.", "error");
    disconnect();
    try {
      const picked = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (!picked.getAudioTracks().length) { picked.getTracks().forEach((t) => t.stop()); return toast("That source did not share audio. In the Windows picker, enable Share audio or choose a source that offers system audio.", "warning"); }
      picked.getVideoTracks().forEach((t) => { t.enabled = false; });
      const ctx = new AudioContext(); const source = ctx.createMediaStreamSource(picked); const analyser = ctx.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = .72;
      const splitter = ctx.createChannelSplitter(2), left = ctx.createAnalyser(), right = ctx.createAnalyser(); left.fftSize = right.fftSize = 1024;
      const processor = ctx.createScriptProcessor(4096, 2, 2), sink = ctx.createGain(); sink.gain.value = 0;
      source.connect(analyser); source.connect(splitter); splitter.connect(left, 0); splitter.connect(right, Math.min(1, source.channelCount - 1)); source.connect(processor); processor.connect(sink); sink.connect(ctx.destination);
      processor.onaudioprocess = (e) => { if (!recordingStart.current) return; captured.current.push([new Float32Array(e.inputBuffer.getChannelData(0)), new Float32Array(e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : e.inputBuffer.getChannelData(0))]); };
      audio.current = { ctx, source, analyser, left, right, processor, sink }; streamRef.current = picked; setStream(picked);
      setSourceName(picked.getAudioTracks()[0]?.label || picked.getVideoTracks()[0]?.label || "Windows audio source");
      frames.current = 0; average.current.fill(0); picked.getTracks().forEach((t) => t.addEventListener("ended", disconnect, { once: true }));
      toast("Reference source connected", "success");
    } catch (e) { if ((e as Error).name !== "NotAllowedError") toast((e as Error).message, "error"); }
  };

  const compareMaster = async () => {
    const existing = project.master.plugins.find((p) => p.type === "s4000eq");
    const plugin = existing || await act("plugin.add", { trackId: "master", plugin: "s4000eq" }) as Plugin | undefined;
    if (plugin?.id) { setMasterPlugin(plugin.id); toast("DAW master overlay enabled", "success"); await refreshProject(); }
  };

  const toggleRecord = async () => {
    if (!audio.current) return toast("Choose a Windows audio source first", "warning");
    if (!recording) { captured.current = []; recordingStart.current = live.tick.t; setRecording(true); return; }
    setRecording(false); const start = recordingStart.current; recordingStart.current = 0;
    if (!captured.current.length) return toast("No reference audio was captured", "warning");
    let trackId = project.tracks.find((t) => t.id === selectedTrack && /reference/i.test(t.name))?.id;
    if (!trackId) {
      const ids = await act("track.add", { kind: "audio", channels: 2, name: "Reference" }) as string[] | undefined; trackId = ids?.[0];
      if (!trackId) return; selectTrack(trackId);
    }
    const blob = wavBlob(captured.current, audio.current.ctx.sampleRate); const data = await blobBase64(blob); const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let file = ""; const chunk = 512 * 1024;
    for (let i = 0; i < data.length; i += chunk) file = await rpc<string>("media.writeFile", { name: `Reference-${stamp}.wav`, data: data.slice(i, i + chunk), append: i > 0 });
    await act("clip.importAudio", { trackId, file, start }); await refreshProject(); toast("Reference recording added to the timeline", "success");
  };

  const saveProfile = () => {
    if (!frames.current) return toast("Play the reference for a few seconds first", "warning");
    const name = prompt("Reference profile name", sourceName.replace(/\s*[-–—].*/, "").slice(0, 40) || "Reference")?.trim(); if (!name) return;
    const item: Profile = { id: crypto.randomUUID(), name, spectrum: Array.from(average.current), width, created: new Date().toISOString() };
    const next = [item, ...profiles].slice(0, 50); setProfiles(next); setProfileId(item.id); saveProfiles(next); toast("Reference profile saved", "success");
  };

  const applyMatch = async () => {
    const target = profiles.find((p) => p.id === profileId); const track = project.tracks.find((t) => t.id === targetTrack);
    if (!target) return toast("Choose a saved profile", "warning"); if (!track || (track.kind !== "audio" && track.kind !== "instrument")) return toast("Choose an audio or instrument target track", "warning");
    const atHz = (a: number[], hz: number) => a[clamp(Math.round((Math.log(hz / 20) / Math.log(1000)) * BINS - .5), 0, BINS - 1)] || -100;
    const targetBands = FREQS.map((hz) => atHz(target.spectrum, hz));
    const raw = masterSpec.length === BINS ? FREQS.map((hz, i) => targetBands[i] - atHz(masterSpec, hz)) : targetBands;
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    const gains = raw.map((v) => clamp(v - mean, -6, 6));
    const params: Record<string, number> = {}; FREQS.forEach((hz, i) => { params[`b${i + 1}on`] = 1; params[`b${i + 1}type`] = 2; params[`b${i + 1}freq`] = hz; params[`b${i + 1}gain`] = gains[i]; params[`b${i + 1}q`] = .8; });
    const p = await act("plugin.add", { trackId: track.id, plugin: "s4000eq", params }) as Plugin | undefined; if (p?.id) { await refreshProject(); openPlugin(p.id); toast(`Matched ${track.name} toward “${target.name}” with a safe ±6 dB EQ`, "success"); }
  };

  const targets = project.tracks.filter((t) => t.kind === "audio" || t.kind === "instrument");
  const profileSelect = <select className="input sm reference-profile-select" value={profileId} onChange={(e) => setProfileId(e.target.value)}><option value="">Load saved profile…</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>;
  const targetSelect = <select className="input sm reference-target-select" value={targetTrack} onChange={(e) => setTargetTrack(e.target.value)}><option value="">Target track…</option>{targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>;

  if (!open) return (stream || profiles.length) ? <div className="reference-background-pill" title="Reference Match remains available while its analyzer is hidden">
    <span className={stream ? "dot live" : "dot"} /><b className="ellipsis">Reference Match</b>{recording && <span className="pill err">REC</span>}
    {profileSelect}{targetSelect}
    <button className="btn sm accent" disabled={!profileId || !targetTrack} onClick={applyMatch}>Apply EQ</button>
    <button className="btn sm" onClick={() => useStore.setState({ referenceOpen: true })}>Open analyzer</button>
    {stream && <button className="btn sm ghost" disabled={recording} onClick={disconnect} title={recording ? "Stop the reference recording before disconnecting" : "Stop capturing this source"}>Disconnect</button>}
  </div> : null;

  return <div className="fx-window reference-window" style={{ left: pos.x, top: pos.y, width: Math.min(980, window.innerWidth - 24), maxHeight: "calc(100vh - 16px)", ["--accent" as string]: "#29c1ff" }}>
    <div className="fx-window-head" onPointerDown={(e) => {
      if ((e.target as HTMLElement).closest("button,select,input")) return;
      (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    }} onPointerMove={(e) => {
      if (!drag.current) return;
      setPos({ x: Math.min(window.innerWidth - 150, Math.max(-820, e.clientX - drag.current.dx)), y: Math.min(window.innerHeight - 50, Math.max(0, e.clientY - drag.current.dy)) });
    }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <span className="fx-window-badge">Reference</span><Icon name="scope" size={15} />
      <div className="col grow" style={{ gap: 0, minWidth: 0 }}><b>Reference Analyzer</b><span className="small faint ellipsis">{sourceName} · runs while hidden</span></div>
      {stream && <span className="fx-live"><i /> {recording ? "Recording" : "Live source"}</span>}
      <button className="btn sm ghost" disabled={!stream || recording} onClick={disconnect} title={recording ? "Stop the recording before disconnecting" : "Stop capturing the external source"}><Icon name="power" size={12} /> Disconnect</button>
      <button className="btn ghost icon sm" onClick={() => useStore.setState({ referenceOpen: false })} title="Hide — analysis keeps running"><Icon name="x" size={14} /></button>
    </div>
    <div className="fx-window-body reference-tool">
      <div className="reference-source row"><span className={stream ? "dot live" : "dot"} /><b className="grow ellipsis" title={sourceName}>{sourceName}</b><button className="btn accent" onClick={chooseSource}><Icon name="window" size={13} /> Choose app / window</button><button className="btn" onClick={compareMaster} disabled={!!masterPlugin}>Compare DAW master</button></div>
      <div className="reference-graphs"><div className="reference-spectrum"><div className="row small"><b className="grow">Frequency comparison</b><span className="reference-key external">Live reference</span><span className="reference-key master">DAW master</span><span className="reference-key profile">Saved profile</span></div><canvas ref={canvas} /></div><div className="reference-field"><div className="row small"><b className="grow">Stereo field</b><span>{width}% width</span></div><canvas ref={field} /></div></div>
      <div className="reference-actions">
        <button className={recording ? "btn danger" : "btn"} onClick={toggleRecord} disabled={!stream}><Icon name={recording ? "stop" : "record"} size={13} /> {recording ? "Stop and place recording" : "Record source to Reference track"}</button>
        <button className="btn" onClick={saveProfile} disabled={!stream}><Icon name="save" size={13} /> Save profile</button>
        {profileSelect}{targetSelect}
        <button className="btn accent" onClick={applyMatch} disabled={!profileId || !targetTrack}>Apply match EQ to target track</button>
      </div>
      <p className="small dim">Choose a source in the Windows picker and enable <b>Share audio</b>. Let it play to build a stable average. “Apply match” creates an editable eight-band Parametric EQ and limits corrections to ±6 dB; it does not copy loudness or mastering.</p>
      <div className="row small faint"><span className="grow">External audio stays separate from the DAW master. Hiding this window keeps analysis and capture active.</span><button className="btn sm" onClick={() => useStore.setState({ referenceOpen: false })}>Hide window</button></div>
    </div>
  </div>;
}
