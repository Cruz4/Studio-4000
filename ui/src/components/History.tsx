import { useEffect, useState } from "react";
import { rpc } from "../bridge";
import { act, useStore } from "../store";

/** Lists the engine's undo and redo names. Choosing one walks back or forward to that step. */
export function History() {
  const open = useStore((s) => s.historyOpen);
  const stamp = useStore((s) => `${s.project?.undoName ?? ""}|${s.project?.redoName ?? ""}|${s.project?.canUndo}|${s.project?.canRedo}`);
  const [hist, setHist] = useState<{ undo: string[]; redo: string[] }>({ undo: [], redo: [] });

  useEffect(() => {
    if (!open) return;
    let live = true;
    rpc<{ undo?: string[]; redo?: string[] }>("edit.history")
      .then((h) => { if (live) setHist({ undo: h?.undo ?? [], redo: h?.redo ?? [] }); })
      .catch(() => {});
    return () => { live = false; };
  }, [open, stamp]);

  if (!open) return null;
  const redo = [...hist.redo].reverse();

  return (
    <div className="history">
      <div className="history-head">
        <b>History</b>
        <button className="btn ghost sm" onClick={() => useStore.setState({ historyOpen: false })}>Close</button>
      </div>
      <div className="history-list">
        {redo.map((name, i) => (
          <button key={`r${i}`} className="history-item redo" title="Redo to here" onClick={() => act("edit.jump", { steps: -(redo.length - i) })}>{name}</button>
        ))}
        <div className="history-now">Now</div>
        {hist.undo.length === 0 && redo.length === 0 && <div className="small faint">Nothing to undo yet</div>}
        {hist.undo.map((name, i) => (
          <button key={`u${i}`} className="history-item" title="Undo to here" onClick={() => act("edit.jump", { steps: i + 1 })}>{name}</button>
        ))}
      </div>
    </div>
  );
}
