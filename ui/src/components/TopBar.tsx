import { useEffect, useRef, useState } from "react";
import akasheet from "../assets/akasheet.png";
import emblem from "../assets/emblem.png";
import { native } from "../bridge";
import { runCommand, toggleMixerView, toggleRecord } from "../commands";
import { AKASHEET_TIP, AKASHEET_URL } from "../support";
import { useMeterCanvas } from "../meters";
import { act, live, onTick, useStore } from "../store";
import { cx, formatBars, formatTime } from "../util";
import { openMenu } from "./ContextMenu";
import { Icon } from "./ui";

function Clock() {
  const project = useStore((s) => s.project);
  const fmt = useStore((s) => s.timeFormat);
  const main = useRef<HTMLSpanElement>(null);
  const sub = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const draw = () => {
      const t = live.tick.t;
      if (main.current) main.current.textContent = fmt === "bars" ? formatBars(t, project) : formatTime(t);
      if (sub.current) sub.current.textContent = fmt === "bars" ? formatTime(t) : formatBars(t, project);
    };
    draw();
    return onTick(draw) as () => void;
  }, [project, fmt]);

  return (
    <div className="lcd clock" title="Click to switch between bars and time"
      onClick={() => useStore.setState({ timeFormat: fmt === "bars" ? "time" : "bars" })}>
      <span className="main" ref={main} />
      <span className="sub" ref={sub} />
    </div>
  );
}

function Tempo() {
  const project = useStore((s) => s.project)!;
  const [v, setV] = useState(String(project.bpm));
  useEffect(() => setV(String(Math.round(project.bpm * 100) / 100)), [project.bpm]);
  const commit = () => {
    const bpm = parseFloat(v);
    if (bpm >= 20 && bpm <= 400 && bpm !== project.bpm) act("project.setTempo", { bpm });
    else setV(String(project.bpm));
  };
  return (
    <div className="lcd tempo">
      <div className="readout" title="Tempo. Scroll to adjust, or click to type">
        <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          onWheel={(e) => act("project.setTempo", { bpm: Math.max(20, Math.min(400, project.bpm + (e.deltaY < 0 ? 1 : -1))) })} />
        <span className="l">BPM</span>
      </div>
      <div className="divider" />
      <div className="readout sig" title="Time signature. Click to change"
        onClick={(e) => openMenu(e, ([[4, 4], [3, 4], [6, 8], [2, 4], [5, 4], [7, 8], [12, 8]] as const).map(([n, d]) => ({
          label: `${n}/${d}`, icon: n === project.timeSig[0] && d === project.timeSig[1] ? "check" : undefined,
          run: () => act("project.setTimeSig", { numerator: n, denominator: d }),
        })))}>
        <span className="v">{project.timeSig[0]}/{project.timeSig[1]}</span>
        <span className="l">TIME</span>
      </div>
    </div>
  );
}

function Loudness() {
  const ref = useMeterCanvas("master", false);
  const m = useRef<HTMLSpanElement>(null);
  const i = useRef<HTMLSpanElement>(null);
  const pk = useRef<HTMLSpanElement>(null);
  useEffect(() => onTick((t) => {
    const f = (v?: number) => (v === undefined || v < -70 ? "–" : v.toFixed(1));
    if (m.current) m.current.textContent = f(t.lufs?.s);
    if (i.current) i.current.textContent = f(t.lufs?.i);
    if (pk.current) {
      pk.current.textContent = f(t.lufs?.peak);
      pk.current.style.color = (t.lufs?.peak ?? -100) > -1 ? "var(--red)" : "";
    }
  }) as () => void, []);
  return (
    <div className="lcd lufs" title="Master loudness (BS.1770). Click to reset the integrated reading" onClick={() => act("smart.resetLoudness")}>
      <div className="readout"><span className="v" ref={m}>–</span><span className="l">SHORT</span></div>
      <div className="readout"><span className="v" ref={i}>–</span><span className="l">LUFS</span></div>
      <div className="readout"><span className="v" ref={pk}>–</span><span className="l">PEAK</span></div>
      <canvas ref={ref} className="master-meter" />
    </div>
  );
}

function Cpu() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => onTick((t) => { if (ref.current) ref.current.textContent = `${Math.round(t.cpu * 100)}%`; }) as () => void, []);
  return <span className="pill" title="Audio engine load"><Icon name="bolt" size={11} /> <span ref={ref}>0%</span></span>;
}

export function TopBar() {
  const project = useStore((s) => s.project);
  const { playing, recording } = useStore((s) => s.transport);
  const side = useStore((s) => s.side);
  const bottom = useStore((s) => s.bottom);
  const view = useStore((s) => s.view);
  const historyOpen = useStore((s) => s.historyOpen);

  if (!project) return null;
  return (
    <div className="topbar">
      <div className="topbar-side">
        <img className="brand-mark" src={emblem} alt="" />
        <div className="project-name" title={project.file}>
          <b>{project.name}{project.modified ? " •" : ""}</b>
          <span>{project.sampleRate ? `${(project.sampleRate / 1000).toFixed(1)} kHz` : ""} · {project.tracks.length} tracks</span>
        </div>
        <button className={cx("view-switch", view === "mixer" && "is-mixer")} onClick={toggleMixerView}
          title={view === "mixer" ? "Back to the track list (F3)" : "Full-page mixer (F3)"}>
          <span className={cx(view === "tracks" && "on")}><Icon name="layers" size={13} /> Tracks</span>
          <span className={cx(view === "mixer" && "on")}><Icon name="mixer" size={13} /> Mixer</span>
        </button>
        <div className="seg">
          <button className="btn ghost icon" title={project.undoName ? `Undo ${project.undoName} (Ctrl+Z)` : "Undo (Ctrl+Z)"} disabled={!project.canUndo} onClick={() => act("edit.undo")}><Icon name="undo" /></button>
          <button className="btn ghost icon" title={project.redoName ? `Redo ${project.redoName} (Ctrl+Y)` : "Redo (Ctrl+Y)"} disabled={!project.canRedo} onClick={() => act("edit.redo")}><Icon name="redo" /></button>
          <button className={cx("btn ghost", historyOpen && "on")} title="History" onClick={() => useStore.setState((s) => ({ historyOpen: !s.historyOpen }))}>History</button>
        </div>
      </div>

      <div className="console">
        <div className="transport">
          <button className="tbtn" title="Go to start (Home)" onClick={() => act("transport.setPosition", { time: 0 })}><Icon name="toStart" size={15} /></button>
          <button className="tbtn" title="Back one bar (,)" onClick={() => act("transport.nudge", { bars: -1 })}><Icon name="rewind" size={15} /></button>
          <button className={cx("tbtn play", playing && !recording && "on")} title="Play / Stop (Space)" onClick={() => act(playing ? "transport.stop" : "transport.play")}>
            <Icon name={playing ? "stop" : "play"} size={18} />
          </button>
          <button className={cx("tbtn rec", recording && "on")} title="Record (R). Arms the selected track if nothing is armed" onClick={toggleRecord}><Icon name="record" size={18} /></button>
          <button className="tbtn" title="Forward one bar (.)" onClick={() => act("transport.nudge", { bars: 1 })}><Icon name="forward" size={15} /></button>
          <div className="sep" />
          <button className={cx("tbtn", project.looping && "on")} title="Loop (L). Recording while looping stacks takes" onClick={() => runCommand("loop")}><Icon name="loop" /></button>
          <button className={cx("tbtn", project.punch && "on")} title="Punch in/out inside the loop range (P)" onClick={() => runCommand("punch")}><Icon name="punch" /></button>
          <button className={cx("tbtn", project.click && "on")} title="Metronome (C)" onClick={() => runCommand("click")}><Icon name="metronome" /></button>
          <button className={cx("tbtn", project.countIn !== "none" && "on")} title={`Count-in before recording: ${project.countIn === "twoBars" ? "2 bars" : project.countIn === "oneBar" ? "1 bar" : "off"}. Click to cycle off, 1 bar, 2 bars (Shift+C).`} onClick={() => runCommand("countIn")}>
            <span className="count-in">{project.countIn === "twoBars" ? "2" : project.countIn === "oneBar" ? "1" : "In"}</span>
          </button>
        </div>
        <Clock />
        <Tempo />
        <Loudness />
      </div>

      <div className="topbar-side right">
        <Cpu />
        <div className="seg">
          <button className={cx("btn ghost icon", bottom === "effects" && "on")} title="Effects for the selected track" onClick={() => runCommand("effectsPanel")}><span className="fx-mark">FX</span></button>
          <button className={cx("btn ghost icon", bottom === "mixer" && "on")} title="Mixer panel under the tracks (Tab)" onClick={() => runCommand("mixer")}><Icon name="mixer" /></button>
          <button className={cx("btn ghost icon", bottom === "editor" && "on")} title="Editor (E)" onClick={() => runCommand("editor")}><Icon name="piano" /></button>
          <button className={cx("btn ghost icon", bottom === "smart" && "on")} title="Smart Mix (Ctrl+M)" onClick={() => runCommand("smart")}><Icon name="sparkles" /></button>
          <button className={cx("btn ghost icon", side === "assistant" && "on")} title="AI assistant (Ctrl+J)" onClick={() => runCommand("assistant")}><Icon name="bot" /></button>
          <button className={cx("btn ghost icon", side === "collab" && "on")} title="Collaborate (Ctrl+Shift+C)" onClick={() => runCommand("collab")}><Icon name="users" /></button>
        </div>
        <div className="seg">
          <button className="btn ghost icon" title="Export (Ctrl+E)" onClick={() => useStore.setState({ exportOpen: true })}><Icon name="export" /></button>
          <button className="btn ghost icon" title="Settings (Ctrl+,)" onClick={() => useStore.setState({ settingsOpen: "audio" })}><Icon name="settings" /></button>
          <button className="btn ghost icon akasheet" onClick={() => native.openUrl(AKASHEET_URL)}>
            <img src={akasheet} alt="AKAsheet" />
            <span className="tip">{AKASHEET_TIP}</span>
          </button>
          <button className="btn ghost icon" title="Commands (Ctrl+K)" onClick={() => useStore.setState({ paletteOpen: true })}><Icon name="search" /></button>
        </div>
      </div>
    </div>
  );
}
