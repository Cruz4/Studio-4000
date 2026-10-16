import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

interface AskState {
  title: string;
  hint: string;
  value: string;
  ok: string;
  resolve: (value: string | null) => void;
}

const useAsk = create<{ current: AskState | null }>(() => ({ current: null }));

/** In-app text prompt. The system prompt box titles itself "juce.backend says". */
export function askText(opts: { title: string; hint: string; value?: string; ok?: string }) {
  return new Promise<string | null>((resolve) => {
    useAsk.setState({
      current: { title: opts.title, hint: opts.hint, value: opts.value ?? "", ok: opts.ok ?? "OK", resolve },
    });
  });
}

export function AskDialog() {
  const current = useAsk((s) => s.current);
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!current) return;
    setValue(current.value);
    const t = window.setTimeout(() => input.current?.select(), 0);
    return () => window.clearTimeout(t);
  }, [current]);

  if (!current) return null;
  const close = (v: string | null) => {
    current.resolve(v);
    useAsk.setState({ current: null });
  };

  return (
    <div className="modal-bg" onMouseDown={() => close(null)}>
      <form className="modal" style={{ width: "min(420px, calc(100vw - 40px))" }} onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); close(value.trim() || null); }}>
        <div className="modal-head"><h3>{current.title}</h3></div>
        <div className="modal-body">
          <span className="small dim">{current.hint}</span>
          <input ref={input} className="input" value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(null); } }} />
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={() => close(null)}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>{current.ok}</button>
        </div>
      </form>
    </div>
  );
}
