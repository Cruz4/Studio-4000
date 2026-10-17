import { useEffect, useState } from "react";
import akasheet from "../assets/akasheet.png";
import wordmark from "../assets/wordmark.png";
import { native, rpc } from "../bridge";
import { AKASHEET_TIP, AKASHEET_URL, COFFEE_URL } from "../support";
import { openProject } from "../commands";
import { useGamepadSurface } from "../gamepad/surfaces";
import { usePad } from "../gamepad/pad";
import { act, refreshInfo, useStore } from "../store";
import { clamp, cx } from "../util";
import { Icon, Spinner, ThemeToggle } from "./ui";

const TEMPLATES = [
  { id: "vocal", icon: "mic", title: "Vocal recording", text: "Lead and double vocal tracks with a reverb return, ready to arm." },
  { id: "band", icon: "headphones", title: "Band tracking", text: "Drums, bass, guitars, keys and vocals, plus a drum bus." },
  { id: "beat", icon: "piano", title: "Beat making", text: "Instrument tracks for drums, bass and chords on a grid." },
  { id: "podcast", icon: "users", title: "Podcast / voice", text: "Host and guest mics with auto-ducking music, mastered to −16 LUFS." },
  { id: "blank", icon: "plus", title: "Empty session", text: "A blank canvas with one audio track." },
];

const STEPS = [
  { title: "Pick your audio interface", text: "Choose an ASIO driver for the lowest latency. Settings → Audio lets you switch any time." },
  { title: "Arm a track and press R", text: "Recording starts after the count-in. Loop a section to stack takes, then comp the best parts." },
  { title: "Let Smart Mix do the first pass", text: "It gain-stages every track, balances by role, ducks music under voice and masters to your loudness target. One undo puts it all back." },
  { title: "Bring an AI and your friends", text: "Link Claude, ChatGPT or your own agent to mix with you, or host a live session with voice and screen share." },
];

function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 90) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function Welcome() {
  const info = useStore((s) => s.info);
  const [name, setName] = useState("");
  const [bpm, setBpm] = useState(120);
  const [busy, setBusy] = useState<string | null>(null);
  const [device, setDevice] = useState<{ type: string; output: string; rate?: number; buffer?: number; latency?: number } | null>(null);
  const [padIndex, setPadIndex] = useState(0);
  const padOn = usePad((s) => s.connected && s.enabled);

  useGamepadSurface({
    id: "welcome",
    region: "welcome",
    active: () => !useStore.getState().project,
    bindings: () => ({
      title: "Start",
      bare: {
        a: { label: TEMPLATES[padIndex]?.title ?? "Create", run: () => { const id = TEMPLATES[padIndex]?.id; if (id) create(id); } },
        b: { label: "Guide", run: () => useStore.setState({ guideOpen: true }) },
        x: { label: "Open", run: () => openProject() },
        y: { label: "Audio setup", run: () => useStore.setState({ settingsOpen: "audio" }) },
      },
      onDpad: (dir) => {
        const step = dir === "right" || dir === "down" ? 1 : -1;
        setPadIndex((i) => (i + step + TEMPLATES.length) % TEMPLATES.length);
        return true;
      },
      onFrame: ({ axes, dt }) => {
        if (!axes.ly) return;
        setBpm((value) => {
          const next = clamp(Math.round(value - axes.ly * dt * 40), 20, 400);
          return next === value ? value : next;
        });
      },
      onGlobal: (id) => {
        if (id === "palette") { useStore.setState({ guideOpen: true }); return true; }
        return false;
      },
    }),
  });

  useEffect(() => {
    rpc("devices.get").then((d) => setDevice({ type: d.type, output: d.output, rate: d.current?.sampleRate, buffer: d.current?.bufferSize, latency: d.current ? (d.current.inputLatencyMs ?? 0) + (d.current.outputLatencyMs ?? 0) : undefined })).catch(() => {});
  }, []);

  const create = async (template: string) => {
    setBusy(template);
    const date = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const title = name.trim() || `${TEMPLATES.find((t) => t.id === template)?.title ?? "Session"} ${date}`;
    const r = await act("project.new", { name: title, template, bpm });
    if (r) {
      if (!info?.onboarded) act("settings.set", { key: "onboarded", value: "1" });
      refreshInfo();
    }
    setBusy(null);
  };

  const open = async (file: string) => {
    setBusy(file);
    await act("project.open", { file });
    refreshInfo();
    setBusy(null);
  };

  const firstRun = info && !info.onboarded;

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="hero col" style={{ gap: 0 }}>
          <div className="brand" style={{ marginBottom: 26 }}><img className="wordmark" src={wordmark} alt="Studio 4000" /><span className="pill">{info?.version ?? ""}</span><ThemeToggle /></div>
          <h1>Record the future.</h1>
          <p>A recording studio that sets itself up, mixes with you and lets the whole band join from anywhere. Choose a starting point, or open something you've been working on.</p>

          <div className="row" style={{ marginBottom: 14 }}>
            <input className="input grow" placeholder="Name your session (optional)" value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create("blank")} />
            <label className="row small dim" title="Tempo">
              <input className="input mono" style={{ width: 70 }} type="number" min={20} max={400} value={bpm} onChange={(e) => setBpm(Number(e.target.value) || 120)} /> BPM
            </label>
          </div>

          <div className="templates">
            {TEMPLATES.map((t, i) => (
              <div key={t.id} className={cx("template", padOn && i === padIndex && "pad-focus")} onClick={() => !busy && create(t.id)}>
                <div className="ti">{busy === t.id ? <Spinner /> : <Icon name={t.icon} size={17} />}</div>
                <b>{t.title}</b>
                <span>{t.text}</span>
              </div>
            ))}
            <button className="template akasheet-card" onClick={() => native.openUrl(AKASHEET_URL)}>
              <div className="ti"><img src={akasheet} alt="" /></div>
              <b>AKAsheet</b>
              <span>Artists share and sell their music here.</span>
              <span className="tip">{AKASHEET_TIP}</span>
            </button>
          </div>

          <div className="welcome-actions small faint">
            <button className="btn sm accent" onClick={() => useStore.setState({ guideOpen: true })}>How things work</button>
            <button className="btn sm" onClick={() => useStore.setState({ side: "collab" })}><Icon name="users" size={12} /> Join a live session</button>
            <span className="hint"><span className="kbd">Ctrl+K</span> commands</span>
            <span className="hint"><span className="kbd">?</span> shortcuts</span>
            <span className="hint"><span className="kbd">Ctrl+J</span> AI assistant</span>
            <button className="btn sm ghost" title="Studio 4000 is free. This tip is optional." onClick={() => native.openUrl(COFFEE_URL)}>Buy me a coffee</button>
          </div>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="card col" style={{ padding: 14 }}>
            <div className="row">
              <span className="section-title grow">Audio</span>
              <button className="btn sm" onClick={() => useStore.setState({ settingsOpen: "audio" })}><Icon name="settings" size={12} /> Set up</button>
            </div>
            {device ? (
              <div className="row small">
                <span className="pill live"><span className="dot" />{device.type}</span>
                <span className="ellipsis grow">{device.output || "No output device"}</span>
                {device.rate ? <span className="mono faint">{Math.round(device.rate / 100) / 10} kHz · {device.buffer} smp{device.latency ? ` · ${device.latency.toFixed(1)} ms` : ""}</span> : null}
              </div>
            ) : <span className="small faint">Checking your audio device…</span>}
          </div>

          {firstRun ? (
            <div className="card col" style={{ padding: 14 }}>
              <span className="section-title">Welcome — four things to know</span>
              <div className="steps">
                {STEPS.map((s, i) => (
                  <div key={i} className="step">
                    <span className="n">{i + 1}</span>
                    <div className="col" style={{ gap: 2 }}><b>{s.title}</b><span className="small dim">{s.text}</span></div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="card col" style={{ padding: 14, minHeight: 0 }}>
            <div className="row">
              <span className="section-title grow">Recent</span>
              <button className="btn sm" onClick={openProject}><Icon name="folder" size={12} /> Open…</button>
            </div>
            <div className="col" style={{ gap: 2, maxHeight: 320, overflow: "auto" }}>
              {info?.recent.map((r) => (
                <div key={r.file} className="recent-item" onClick={() => !busy && open(r.file)} title={r.file}>
                  {busy === r.file ? <Spinner /> : <Icon name="wave" size={15} className="faint" />}
                  <span className="grow ellipsis">{r.name}</span>
                  <span className="small faint">{ago(r.modified)}</span>
                </div>
              ))}
              {!info?.recent.length && <span className="small faint">Your sessions will show up here.</span>}
            </div>
          </div>
        </div>
      </div>
      <button className="akasheet-landing" onClick={() => native.openUrl(AKASHEET_URL)}>
        <img src={akasheet} alt="AKAsheet" />
        <span className="tip">{AKASHEET_TIP}</span>
      </button>
    </div>
  );
}
