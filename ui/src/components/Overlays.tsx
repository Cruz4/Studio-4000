import { useState } from "react";
import { localRpc } from "../bridge";
import { commands } from "../commands";
import { act, refreshProject, toast, useStore } from "../store";
import { Icon, Modal } from "./ui";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = (id: number) => useStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`}>
          <Icon name={t.level === "error" || t.level === "warning" ? "alert" : t.level === "success" ? "check" : "info"} size={15} />
          <div className="col grow" style={{ gap: 2 }}>
            {t.title && <b>{t.title}</b>}
            <span style={{ userSelect: "text", whiteSpace: "pre-wrap" }}>{t.message}</span>
          </div>
          {t.action && <button className="btn sm" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
          <button className="btn sm ghost icon" onClick={() => dismiss(t.id)}><Icon name="x" size={12} /></button>
        </div>
      ))}
    </div>
  );
}

export function AgentApproval() {
  const approvals = useStore((s) => s.approvals);
  const [showRaw, setShowRaw] = useState(false);
  const a = approvals[0];
  if (!a) return null;
  const decide = async (approve: boolean) => {
    try { await localRpc("agent.decide", { requestId: a.requestId, approve }); } catch (e) { toast((e as Error).message, "error"); }
    useStore.setState((s) => ({ approvals: s.approvals.filter((x) => x.requestId !== a.requestId) }));
  };
  const counts = a.calls.reduce<Record<string, number>>((m, c) => ({ ...m, [c.method]: (m[c.method] ?? 0) + 1 }), {});

  return (
    <div className="approval">
      <div className="row">
        <Icon name="bot" size={18} />
        <b className="grow">{a.client} wants to change your session</b>
        {approvals.length > 1 && <span className="pill">+{approvals.length - 1} more</span>}
      </div>
      {a.label && <span>{a.label}</span>}
      <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
        {Object.entries(counts).map(([m, n]) => <span key={m} className="pill mono">{m}{n > 1 ? ` ×${n}` : ""}</span>)}
      </div>
      <button className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => setShowRaw(!showRaw)}>
        <Icon name={showRaw ? "chevronDown" : "chevronRight"} size={12} /> Details
      </button>
      {showRaw && <pre>{JSON.stringify(a.calls, null, 2)}</pre>}
      <div className="row">
        <span className="small faint grow">Applied as one step: Ctrl+Z undoes all of it.</span>
        <button className="btn" onClick={() => decide(false)}>Decline</button>
        <button className="btn primary" onClick={() => decide(true)}><Icon name="check" size={13} /> Approve</button>
      </div>
    </div>
  );
}

export function RecoveryBanner() {
  const recovery = useStore((s) => s.recovery);
  if (!recovery) return null;
  const close = () => useStore.setState({ recovery: null });
  return (
    <div className="banner">
      <Icon name="alert" size={15} />
      <span className="grow">This project has a newer autosave than the last save, probably from a crash. Restore it?</span>
      <button className="btn sm" onClick={async () => { await act("project.recover"); close(); refreshProject(); toast("Autosave restored", "success"); }}>Restore autosave</button>
      <button className="btn sm ghost" onClick={close}>Keep saved version</button>
    </div>
  );
}

export function Shortcuts() {
  const open = useStore((s) => s.shortcutsOpen);
  if (!open) return null;
  const groups = [...new Set(commands.map((c) => c.group))];
  const extra = [
    ["Ctrl+K", "Command palette"], ["Ctrl+drag", "Copy clip or note"], ["Alt+drag", "Move without snapping"], ["Ctrl+Alt+drag", "Slip audio inside a clip"], ["Ctrl+wheel", "Zoom timeline"],
    ["Drag line between tracks", "Resize that track (Shift: all, double-click: reset)"], ["Ctrl+wheel on track names", "Resize all tracks"], ["Double-click", "Open clip editor / reset control"], ["Shift+drag knob", "Fine adjust"], ["Right-click", "Context menu"],
  ];
  return (
    <Modal title="Keyboard shortcuts" onClose={() => useStore.setState({ shortcutsOpen: false })} width={820}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 18 }}>
        {groups.map((g) => (
          <div key={g} className="col" style={{ gap: 4 }}>
            <span className="section-title">{g}</span>
            {commands.filter((c) => c.group === g && c.keys).map((c) => (
              <div key={c.id} className="row small"><span className="grow dim">{c.title}</span><span className="kbd">{c.keys}</span></div>
            ))}
          </div>
        ))}
        <div className="col" style={{ gap: 4 }}>
          <span className="section-title">Mouse</span>
          {extra.map(([k, v]) => <div key={k} className="row small"><span className="grow dim">{v}</span><span className="kbd">{k}</span></div>)}
        </div>
      </div>
    </Modal>
  );
}

export function RenderPill() {
  const render = useStore((s) => s.render);
  const exportOpen = useStore((s) => s.exportOpen);
  if (!render || render.state !== "rendering" || exportOpen) return null;
  return (
    <span className="row" style={{ gap: 6, cursor: "pointer" }} onClick={() => useStore.setState({ exportOpen: true })}>
      <Icon name="export" size={11} /> {render.label} {Math.round((render.progress ?? 0) * 100)}%
      <span className="progress" style={{ width: 80 }}><div style={{ width: `${(render.progress ?? 0) * 100}%` }} /></span>
    </span>
  );
}
