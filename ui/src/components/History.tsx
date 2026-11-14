import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { rpc } from "../bridge";
import { historyEntries } from "../history";
import { jumpHistory, useStore } from "../store";
import { Icon } from "./ui";

interface HistorySnapshot { undo: string[]; redo: string[] }

/** Every row represents a real transaction; step counts include unnamed edits. */
export function History() {
  const open = useStore((s) => s.historyOpen);
  const project = useStore((s) => s.project);
  const [hist, setHist] = useState<HistorySnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [position, setPosition] = useState({ left: 12, top: 72, maxHeight: 520 });
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !project) { setHist(null); return; }
    let live = true;
    // Repeated action names still produce a new project snapshot.
    rpc<Partial<HistorySnapshot>>("edit.history")
      .then((h) => { if (live) { setHist({ undo: h?.undo ?? [], redo: h?.redo ?? [] }); setError(""); } })
      .catch(() => { if (live) setError("Could not load history. Try again."); });
    return () => { live = false; };
  }, [open, project, reload]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = document.querySelector("[data-history-toggle]")?.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24);
      const top = (anchor?.bottom ?? 64) + 8;
      setPosition({ left: Math.max(12, Math.min((anchor?.right ?? width + 12) - width, window.innerWidth - width - 12)),
        top, maxHeight: Math.max(100, Math.min(560, window.innerHeight * .7, window.innerHeight - top - 12)) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, project?.name]);

  const close = () => {
    useStore.setState({ historyOpen: false });
    document.querySelector<HTMLButtonElement>("[data-history-toggle]")?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Element && !panel.current?.contains(e.target) && !e.target.closest("[data-history-toggle]"))
        useStore.setState({ historyOpen: false });
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); };
  }, [open]);

  async function jump(steps: number) {
    if (busy) return;
    setBusy(true); setError("");
    try { await jumpHistory(steps); setReload((n) => n + 1); }
    catch { setError("Could not change history. Try again."); }
    finally { setBusy(false); }
  }

  if (!open || !project) return null;
  const undo = historyEntries(hist?.undo ?? [], "undo");
  const redo = historyEntries(hist?.redo ?? [], "redo");
  const rows = (direction: "undo" | "redo", entries: ReturnType<typeof historyEntries>) => (
    <section className="history-section" aria-label={direction === "undo" ? "Undo changes" : "Redo changes"}>
      <div className="history-section-head"><span>{direction === "undo" ? "Undo" : "Redo"}</span><span>{entries.length}</span></div>
      <div className="history-entries">
        {entries.map(({ name, steps }) => {
          const count = Math.abs(steps);
          const action = direction === "undo" ? "Undo" : "Redo";
          return <button key={steps} className={`history-item ${direction}`} disabled={busy}
            title={`${action} ${count} ${count === 1 ? "change" : "changes"}: ${name}`} onClick={() => void jump(steps)}>
            <Icon name={direction} size={14} />
            <span className="history-name">{name}</span>
            <span className="history-distance">{count} {count === 1 ? "step" : "steps"}</span>
          </button>;
        })}
      </div>
    </section>
  );

  return (
    <div ref={panel} id="edit-history" className="history" style={position} role="dialog" aria-labelledby="history-title" aria-busy={busy}>
      <div className="history-head">
        <div><b id="history-title">History</b><p>Choose how far to undo or redo.</p></div>
        <button className="btn ghost sm icon" title="Close history" onClick={close}><Icon name="x" size={14} /></button>
      </div>
      {error && <div className="history-error" role="alert"><span>{error}</span><button className="btn ghost sm" onClick={() => setReload((n) => n + 1)}>Retry</button></div>}
      {hist && <div className="history-now"><span className="history-dot" /><b>Current state</b><span>You are here</span></div>}
      <div className="history-list">
        {!hist && !error && <div className="history-empty">Loading history...</div>}
        {hist && <>
          {undo.length > 0 && rows("undo", undo)}
          {redo.length > 0 && rows("redo", redo)}
          {undo.length === 0 && redo.length === 0 && <div className="history-empty"><b>No edits yet</b><span>Your track, clip and effect changes will appear here.</span></div>}
        </>}
      </div>
      <div className="history-footer"><span><kbd>Ctrl Z</kbd> Undo</span><span><kbd>Ctrl Y</kbd> Redo</span></div>
    </div>
  );
}
