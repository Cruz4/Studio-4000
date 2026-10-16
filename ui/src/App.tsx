import { useEffect } from "react";
import { isNative, native } from "./bridge";
import { showBrowser, toggleBottom } from "./commands";
import { useCollab } from "./collab";
import { useStore, type BottomTab, type BrowserTab } from "./store";
import { cx } from "./util";
import { About } from "./components/About";
import { AskDialog } from "./components/Ask";
import { Arrange } from "./components/Arrange";
import { Assistant } from "./components/Assistant";
import { Browser } from "./components/Browser";
import { Collab } from "./components/Collab";
import { ContextMenu } from "./components/ContextMenu";
import { Editor } from "./components/Editor";
import { ExportDialog } from "./components/ExportDialog";
import { Guide } from "./components/Guide";
import { KeysStrip } from "./components/Keys";
import { History } from "./components/History";
import { MenuBar } from "./components/MenuBar";
import { Mixer } from "./components/Mixer";
import { AgentApproval, RecoveryBanner, RenderPill, Shortcuts, Toasts } from "./components/Overlays";
import { Palette } from "./components/Palette";
import { PluginPanel, PluginPicker } from "./components/PluginPanel";
import { Settings } from "./components/Settings";
import { SmartPanel } from "./components/SmartPanel";
import { TopBar } from "./components/TopBar";
import { Welcome } from "./components/Welcome";
import { ErrorBoundary, Icon, startDrag } from "./components/ui";

const DOCK_TABS: { id: BottomTab; label: string; icon: string; keys: string }[] = [
  { id: "mixer", label: "Mixer", icon: "mixer", keys: "Tab" },
  { id: "editor", label: "Editor", icon: "piano", keys: "E" },
  { id: "smart", label: "Smart Mix", icon: "sparkles", keys: "Ctrl+M" },
];

function Dock() {
  const bottom = useStore((s) => s.bottom);
  const height = useStore((s) => s.bottomHeight);
  const mixerView = useStore((s) => s.view === "mixer");
  if (!bottom || (mixerView && bottom === "mixer")) return null;
  return (
    <div className="dock" style={{ height }}>
      <div className="dock-resize" onPointerDown={(e) => {
        const h0 = useStore.getState().bottomHeight;
        startDrag(e, (_dx, dy) => useStore.setState({ bottomHeight: Math.max(160, Math.min(window.innerHeight - 220, h0 - dy)) }));
      }} />
      <div className="dock-head">
        <div className="tabs">
          {DOCK_TABS.map((t) => (
            <button key={t.id} className={cx("tab", bottom === t.id && "on")} onClick={() => useStore.setState({ bottom: t.id })} title={t.keys}>
              <Icon name={t.icon} size={14} />{t.label}
            </button>
          ))}
        </div>
        <div className="grow" />
        <button className="btn sm ghost icon" title="Hide" onClick={() => toggleBottom(bottom)}><Icon name="chevronDown" size={14} /></button>
      </div>
      <div className="dock-body">
        <ErrorBoundary key={bottom} name={DOCK_TABS.find((t) => t.id === bottom)?.label ?? "Panel"}>
          {bottom === "mixer" && <Mixer />}
          {bottom === "editor" && <Editor />}
          {bottom === "smart" && <SmartPanel />}
        </ErrorBoundary>
      </div>
    </div>
  );
}

function Side() {
  const side = useStore((s) => s.side);
  const live = useCollab((s) => s.status === "live");
  if (!side) return null;
  return (
    <div className="side">
      <div className="side-head">
        <Icon name={side === "assistant" ? "bot" : "users"} size={16} />
        <b className="grow">{side === "assistant" ? "AI assistant" : "Live session"}</b>
        {side === "collab" && live && <span className="pill live"><span className="dot" /> live</span>}
        <button className="btn sm ghost icon" onClick={() => useStore.setState({ side: null })}><Icon name="x" size={13} /></button>
      </div>
      <ErrorBoundary key={side} name={side === "assistant" ? "AI assistant" : "Live session"}>
        {side === "assistant" ? <Assistant /> : <Collab />}
      </ErrorBoundary>
    </div>
  );
}

/** What's left of the browser when it's collapsed: one click brings back the tab you want. */
function BrowserRail() {
  const items: { tab: BrowserTab; icon: string; label: string }[] = [
    { tab: "fx", icon: "wand", label: "Effects" },
    { tab: "inst", icon: "piano", label: "Instruments" },
    { tab: "media", icon: "wave", label: "Media" },
    { tab: "chains", icon: "layers", label: "Chains" },
  ];
  return (
    <div className="browser-rail">
      <button className="btn ghost icon" title="Show the browser (B)" onClick={() => useStore.setState({ browserOpen: true })}><Icon name="sidebar" size={15} /></button>
      <div className="rail-sep" />
      {items.map((i) => (
        <button key={i.tab} className="btn ghost icon" title={i.label} onClick={() => showBrowser(i.tab)}><Icon name={i.icon} size={15} /></button>
      ))}
      <div className="grow" />
      <button className="btn ghost icon" title="On-screen keyboard and musical typing (Shift+K)" onClick={() => useStore.setState((s) => ({ keysOpen: !s.keysOpen }))}><Icon name="keyboard" size={15} /></button>
    </div>
  );
}

function GuestBanner() {
  const role = useCollab((s) => s.role);
  const status = useCollab((s) => s.status);
  const host = useCollab((s) => s.peers.find((p) => p.role === "host"));
  if (role !== "guest" || status !== "live") return null;
  return (
    <div className="banner" style={{ color: "var(--cyan)", background: "rgba(0,209,255,.08)", borderColor: "rgba(0,209,255,.3)" }}>
      <Icon name="users" size={15} />
      <span className="grow">You're in {host ? `${host.name}'s` : "the host's"} session. Everything you do edits their project live.</span>
      <button className="btn sm" onClick={() => useStore.setState({ side: "collab" })}>Session panel</button>
    </div>
  );
}

/** One short, relevant hint based on what the user is doing right now. */
function ContextTip() {
  const tip = useStore((s) => {
    const p = s.project;
    if (!p) return null;
    const clips = p.tracks.flatMap((t) => t.clips);
    const sel = clips.filter((c) => s.selectedClips.includes(c.id));
    const track = p.tracks.find((t) => t.id === s.selectedTrack);
    if (s.transport.recording) return p.looping ? "Recording loop takes. Each pass becomes a take you can comp in the editor (E)" : "Recording. Space stops; Ctrl+Z throws the take away";
    if (!p.tracks.length) return "Ctrl+T adds a track, or drop audio files straight onto the timeline";
    if (p.tracks.some((t) => t.armed)) return `Armed. R records${p.countIn === "none" ? "; Shift+C adds a count-in" : ""}; L loops a range for multiple takes`;
    if (sel.length >= 2 && sel.every((c) => c.kind === "audio")) return "X crossfades overlapping clips · Ctrl+D duplicates · right-click for more";
    if (sel.length === 1 && sel[0].kind === "audio") return "Drag the top corners to fade · Ctrl+Alt+drag slips the audio · S splits at the playhead";
    if (sel.length === 1 && sel[0].kind === "midi") return "Double-click to edit notes · Q quantizes to 1/16";
    if (track?.kind === "audio" && !track.clips.length) return "Shift+R arms this track, then R records. Right-click the header for instant vocal chains";
    if (track?.kind === "audio" && track.plugins.length === 0 && /vox|vocal|voice|lead/i.test(track.name)) return "Right-click the track header → Vocal chain for a finished vocal sound in one step";
    if (clips.length >= 3 && !p.master.plugins.length) return "Ctrl+M opens Smart Mix: level-match tracks and master to a loudness target";
    return null;
  });
  return tip ? <span className="ellipsis faint" style={{ minWidth: 0 }} title={tip}><Icon name="info" size={11} /> {tip}</span> : null;
}

function StatusBar() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selectedClips.length);
  const grid = useStore((s) => s.grid);
  const agentClients = useStore((s) => s.agentActivity.length);
  const collab = useCollab((s) => (s.status === "live" ? `${s.room} · ${s.peers.length} in session` : null));
  return (
    <div className="statusbar">
      {isNative ? <span className="row" style={{ gap: 5 }}><span className="dot" style={{ color: "var(--green)" }} /> Engine</span>
                : <span className="row" style={{ gap: 5, color: "var(--amber)" }}><span className="dot" /> Preview mode (no audio engine)</span>}
      {project && <span>{project.bpm.toFixed(project.bpm % 1 ? 2 : 0)} BPM · {project.timeSig[0]}/{project.timeSig[1]}</span>}
      {project && <span>Snap: {grid === "off" ? "off" : grid}</span>}
      {selected > 0 && <span>{selected} clip{selected === 1 ? "" : "s"} selected</span>}
      <RenderPill />
      <div className="grow" style={{ minWidth: 0, display: "flex", justifyContent: "center" }}><ContextTip /></div>
      {collab && <span className="row" style={{ gap: 5, cursor: "pointer", color: "var(--cyan)" }} onClick={() => useStore.setState({ side: "collab" })}><Icon name="users" size={11} /> {collab}</span>}
      {agentClients > 0 && <span className="row" style={{ gap: 5, cursor: "pointer" }} onClick={() => useStore.setState({ settingsOpen: "agent" })}><Icon name="link" size={11} /> Agent active</span>}
      <span className="row" style={{ gap: 5, cursor: "pointer" }} onClick={() => useStore.setState({ paletteOpen: true })}><span className="kbd">Ctrl K</span> commands</span>
    </div>
  );
}

export function App() {
  const project = useStore((s) => s.project);
  const browserOpen = useStore((s) => s.browserOpen);
  const view = useStore((s) => s.view);

  useEffect(() => {
    if (isNative) native.window("title", project ? `${project.name}${project.modified ? " •" : ""} — Studio 4000` : "Studio 4000");
  }, [project?.name, project?.modified]);

  return (
    <>
      {project ? (
        <div className="app">
          <div>
            <MenuBar />
            <TopBar />
            <RecoveryBanner />
            <GuestBanner />
          </div>
          <div className="workspace">
            {browserOpen ? <ErrorBoundary name="Browser"><Browser /></ErrorBoundary> : <BrowserRail />}
            <div className="center">
              {view === "mixer"
                ? <ErrorBoundary name="Mixer"><div className="mixer-page"><Mixer full /></div></ErrorBoundary>
                : <ErrorBoundary name="Arrangement"><Arrange /></ErrorBoundary>}
              <Dock />
              <ErrorBoundary name="Keyboard"><KeysStrip /></ErrorBoundary>
            </div>
            <Side />
          </div>
          <StatusBar />
        </div>
      ) : (
        <>
          <ErrorBoundary name="Start screen"><Welcome /></ErrorBoundary>
          <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, zIndex: 95, display: "flex" }}><Side /></div>
        </>
      )}
      <ErrorBoundary floating name="Plug-in windows" onReset={() => useStore.setState({ openPlugins: [], selectedPlugin: null })}><PluginPanel /></ErrorBoundary>
      <ErrorBoundary floating name="Plug-in picker" onReset={() => useStore.setState({ picker: null })}><PluginPicker /></ErrorBoundary>
      <ContextMenu />
      <AskDialog />
      <Palette />
      <Settings />
      <ExportDialog />
      <History />
      <Guide />
      <About />
      <Shortcuts />
      <AgentApproval />
      <Toasts />
    </>
  );
}
