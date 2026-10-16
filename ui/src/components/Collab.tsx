import { useEffect, useRef, useState } from "react";
import { localRpc, rpc } from "../bridge";
import { downloadFile, leaveSession, randomRoom, sendChat, setNotes, startSession, toggleMic, toggleScreen, useCollab } from "../collab";
import { toast, useStore } from "../store";
import { cx } from "../util";
import { Icon, Spinner, Tabs } from "./ui";

function Video({ stream, label, muted }: { stream: MediaStream; label: string; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return (
    <div className="video-tile" onDoubleClick={() => ref.current?.requestFullscreen()}>
      <video ref={ref} autoPlay playsInline muted={muted} />
      <span className="who">{label}</span>
    </div>
  );
}

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <audio ref={ref} autoPlay />;
}

function Avatar({ name, colour }: { name: string; colour: string }) {
  return <span className="avatar" style={{ background: colour }}>{name.slice(0, 2).toUpperCase()}</span>;
}

function JoinForm() {
  const hasProject = useStore((s) => !!s.project);
  const st = useCollab();
  const [name, setName] = useState("");
  const [server, setServer] = useState("ws://localhost:3031");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [turn, setTurn] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all(["collabName", "collabServer", "collabTurn"].map((key) => localRpc<string>("settings.get", { key }).catch(() => ""))).then(([n, s, t]) => {
      setName(n || "Musician");
      if (s) setServer(s);
      if (t) setTurn(t);
    });
  }, []);

  const go = async (role: "host" | "guest") => {
    const room = role === "host" ? randomRoom() : code.trim().toUpperCase();
    if (!room) return toast("Enter the session code you were given", "warning");
    setBusy(true);
    localRpc("settings.set", { key: "collabName", value: name });
    localRpc("settings.set", { key: "collabServer", value: server });
    localRpc("settings.set", { key: "collabTurn", value: turn });
    try {
      await startSession({ server, room, name: name || "Musician", role, password, turn });
      toast(role === "host" ? `Session ${room} is live. Share the code with your collaborators.` : "Joined the session", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card col" style={{ padding: 12, background: "linear-gradient(135deg, rgba(0,209,255,.12), rgba(124,92,255,.1))" }}>
        <b><Icon name="users" size={14} /> Make music together</b>
        <span className="small dim">Host your session and others see it live, edit with you, talk over voice and watch your screen. Share your screen with audio to let everyone hear the mix in real time.</span>
      </div>
      <label className="field"><span>Your name</span><input className="input sm" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button className="btn primary" disabled={busy || !hasProject} onClick={() => go("host")} title={hasProject ? "" : "Open a project first"}>
        {busy ? <Spinner /> : <Icon name="bolt" size={13} />} Host this session
      </button>
      <div className="row"><div className="grow" style={{ height: 1, background: "var(--line)" }} /><span className="small faint">or join one</span><div className="grow" style={{ height: 1, background: "var(--line)" }} /></div>
      <div className="row">
        <input className="input sm grow mono" placeholder="Session code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} />
        <button className="btn" disabled={busy || !code.trim()} onClick={() => go("guest")}>Join</button>
      </div>
      <details>
        <summary className="small faint" style={{ cursor: "pointer" }}>Connection settings</summary>
        <div className="col" style={{ marginTop: 8 }}>
          <label className="field"><span>Session server</span><input className="input sm mono" value={server} onChange={(e) => setServer(e.target.value)} /></label>
          <span className="small faint">Run <span className="kbd">node server/index.mjs</span> on any machine everyone can reach (your LAN, or a small cloud VM with wss://).</span>
          <label className="field"><span>Room password (optional)</span><input className="input sm" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label className="field"><span>TURN servers (JSON, for strict networks)</span><input className="input sm mono" placeholder='[{"urls":"turn:host:3478","username":"u","credential":"p"}]' value={turn} onChange={(e) => setTurn(e.target.value)} /></label>
        </div>
      </details>
      {st.status === "error" && st.error && <div className="pill err">{st.error}</div>}
    </div>
  );
}

function Live() {
  const st = useCollab();
  const [tab, setTab] = useState<"chat" | "notes" | "files" | "activity">("chat");
  const [msg, setMsg] = useState("");
  const [files, setFiles] = useState<{ file: string; name: string; folder: string; size: number }[]>([]);
  const [dl, setDl] = useState<Record<string, number>>({});
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "end" }); }, [st.chat.length]);
  useEffect(() => { if (tab === "files") rpc("media.list").then(setFiles).catch(() => setFiles([])); }, [tab]);

  const videos = Object.entries(st.streams).filter(([, s]) => s.getVideoTracks().some((t) => t.readyState === "live"));
  const nameOf = (id: string) => st.peers.find((p) => p.id === id)?.name ?? "Guest";

  return (
    <div className="col" style={{ gap: 10, minHeight: 0 }}>
      <div className="row">
        <span className="pill live"><span className="dot" /> Live</span>
        <span className="mono" style={{ fontSize: 16, fontWeight: 700, letterSpacing: ".12em" }}>{st.room}</span>
        <button className="btn sm ghost icon" title="Copy session code" onClick={() => { navigator.clipboard?.writeText(st.room); toast("Code copied", "success"); }}><Icon name="copy" size={12} /></button>
        <div className="grow" />
        <button className="btn sm danger" onClick={leaveSession}>{st.role === "host" ? "End" : "Leave"}</button>
      </div>
      <div className="row">
        <button className={cx("btn grow", st.micOn && "on")} onClick={toggleMic}><Icon name={st.micOn ? "mic" : "micOff"} size={14} /> {st.micOn ? "Mic on" : "Mic off"}</button>
        <button className={cx("btn grow", st.sharing && "on")} onClick={toggleScreen} title="Share a window or screen. Tick 'share audio' to stream the mix"><Icon name="screen" size={14} /> {st.sharing ? "Stop sharing" : "Share screen"}</button>
      </div>
      {st.role === "host" && (
        <label className="row small" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={st.allowGuestEdits} onChange={(e) => useCollab.setState({ allowGuestEdits: e.target.checked })} /> Guests can edit (otherwise view and listen only)
        </label>
      )}
      {st.role === "guest" && <span className="small faint">You're seeing the host's session. Your edits go to their project, and their engine plays the audio.</span>}

      <div className="col" style={{ gap: 6 }}>
        {st.peers.map((p) => (
          <div key={p.id} className="peer">
            <Avatar name={p.name} colour={p.colour} />
            <span className="grow ellipsis">{p.name}{p.id === st.me?.id ? " (you)" : ""}</span>
            <span className="pill">{p.role}</span>
            {st.streams[p.id]?.getAudioTracks().length ? <Icon name="mic" size={12} /> : null}
          </div>
        ))}
      </div>

      {st.localScreen && <Video stream={st.localScreen} label="Your screen" muted />}
      {videos.map(([id, s]) => <Video key={id} stream={s} label={nameOf(id)} />)}
      {Object.entries(st.streams).map(([id, s]) => <RemoteAudio key={id} stream={s} />)}

      <Tabs value={tab} onChange={setTab} items={[{ id: "chat", label: "Chat" }, { id: "notes", label: "Notes" }, { id: "files", label: "Files" }, { id: "activity", label: "Activity" }]} />
      {tab === "chat" && (
        <div className="col" style={{ gap: 6 }}>
          <div className="col" style={{ gap: 4, maxHeight: 260, overflow: "auto" }}>
            {st.chat.map((c, i) => (
              <div key={i} className="small" style={{ userSelect: "text" }}>
                <b style={{ color: st.peers.find((p) => p.id === c.from)?.colour ?? "var(--violet2)" }}>{c.name}</b> <span className="faint">{new Date(c.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <div>{c.text}</div>
              </div>
            ))}
            {!st.chat.length && <span className="small faint">Say hi 👋</span>}
            <div ref={chatEnd} />
          </div>
          <div className="row">
            <input className="input sm grow" placeholder="Message" value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { sendChat(msg); setMsg(""); } }} />
            <button className="btn sm icon" onClick={() => { sendChat(msg); setMsg(""); }}><Icon name="send" size={12} /></button>
          </div>
        </div>
      )}
      {tab === "notes" && (
        <textarea className="input" rows={10} placeholder="Shared notes: lyrics, to-dos, arrangement ideas. Everyone edits live." value={st.notes} onChange={(e) => setNotes(e.target.value)} style={{ userSelect: "text" }} />
      )}
      {tab === "files" && (
        <div className="col" style={{ gap: 4 }}>
          <span className="small faint">{st.role === "guest" ? "Download recordings and bounces from the host. Drop files on the timeline to send them to the host." : "Guests can download these from you."}</span>
          {files.map((f) => (
            <div key={f.file} className="b-item" style={{ cursor: "default" }}>
              <Icon name="wave" size={13} /><span className="grow ellipsis">{f.name}</span>
              <span className="small faint">{(f.size / 1048576).toFixed(1)} MB</span>
              {dl[f.file] !== undefined && dl[f.file] < 1 ? <span className="small mono">{Math.round(dl[f.file] * 100)}%</span> : (
                <button className="btn sm ghost icon" title="Download" onClick={() => downloadFile(f.file, f.name, (p) => setDl((d) => ({ ...d, [f.file]: p }))).catch((e) => toast(e.message, "error"))}><Icon name="export" size={12} /></button>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "activity" && (
        <div className="col small" style={{ gap: 3 }}>
          {st.activity.slice().reverse().map((a, i) => <div key={i}><b>{a.name}</b> <span className="mono faint">{a.method}</span> <span className="faint">{new Date(a.time).toLocaleTimeString()}</span></div>)}
          {!st.activity.length && <span className="faint">Edits by guests show up here.</span>}
        </div>
      )}
    </div>
  );
}

export function Collab() {
  const status = useCollab((s) => s.status);
  return <div className="side-body">{status === "live" ? <Live /> : <JoinForm />}</div>;
}
