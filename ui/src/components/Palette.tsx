import { useEffect, useMemo, useRef, useState } from "react";
import { commands, selectedTrack } from "../commands";
import { act, useStore } from "../store";
import { cx } from "../util";
import { Icon } from "./ui";

interface Item { id: string; group: string; title: string; keys?: string; icon?: string; run: () => unknown }

function score(text: string, q: string) {
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 100;
  const i = t.indexOf(q);
  if (i >= 0) return 80 - i;
  let ti = 0, s = 0;
  for (const ch of q) {
    const f = t.indexOf(ch, ti);
    if (f < 0) return 0;
    s += f === ti ? 3 : 1;
    ti = f + 1;
  }
  return s;
}

export function Palette() {
  const open = useStore((s) => s.paletteOpen);
  const catalogue = useStore((s) => s.catalogue);
  const project = useStore((s) => s.project);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(""); setIdx(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = commands.filter((c) => !c.when || c.when()).map((c) => ({ id: c.id, group: c.group, title: c.title, keys: c.keys, run: c.run }));
    for (const t of project?.tracks ?? []) {
      out.push({ id: `track:${t.id}`, group: "Go to", title: `Track: ${t.name}`, icon: "layers", run: () => {
        useStore.setState({ selectedTrack: t.id });
        document.querySelector(`[data-track="${t.id}"]`)?.scrollIntoView({ block: "nearest" });
      } });
    }
    for (const m of project?.markers ?? []) {
      out.push({ id: `marker:${m.id}`, group: "Go to", title: `Marker: ${m.name || m.number}`, icon: "arrowRight", run: () => act("transport.setPosition", { time: m.time }) });
    }
    if (project && q.length > 1) {
      for (const p of catalogue) {
        out.push({ id: `plugin:${p.id}`, group: p.synth ? "Instrument" : "Insert", title: `${p.synth ? "Use" : "Add"} ${p.name}${p.vendor ? ` (${p.vendor})` : ""}`, icon: "plug", run: () => {
          const t = selectedTrack();
          if (!t) return;
          if (p.synth && t.kind === "instrument") {
            const old = t.plugins.find((x) => x.synth);
            return act("batch.run", { label: `Instrument: ${p.name}`, calls: [
              ...(old ? [{ method: "plugin.remove", params: { id: old.id } }] : []),
              { method: "plugin.add", params: { trackId: t.id, plugin: p.id, index: 0 } },
            ] });
          }
          return act("plugin.add", { trackId: t.id, plugin: p.id });
        } });
      }
    }
    return out;
  }, [project, catalogue, q.length > 1]);

  const ql = q.trim().toLowerCase();
  const results = useMemo(() => items
    .map((i) => ({ i, s: Math.max(score(i.title, ql), score(i.group, ql) * 0.5) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 60)
    .map((x) => x.i), [items, ql]);

  useEffect(() => { setIdx(0); }, [ql]);
  useEffect(() => { list.current?.querySelector(".palette-item.on")?.scrollIntoView({ block: "nearest" }); }, [idx]);

  if (!open) return null;
  const close = () => useStore.setState({ paletteOpen: false });
  const run = (i: Item) => { close(); setTimeout(() => i.run(), 0); };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal palette">
        <div className="row" style={{ paddingLeft: 16 }}>
          <Icon name="search" size={16} className="faint" />
          <input ref={input} placeholder="Type a command, track, marker or plug-in…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              else if (e.key === "Enter" && results[idx]) run(results[idx]);
            }} />
        </div>
        <div className="palette-list" ref={list}>
          {results.map((r, i) => (
            <div key={r.id} className={cx("palette-item", i === idx && "on")} onMouseEnter={() => setIdx(i)} onClick={() => run(r)}>
              <span className="grp">{r.group}</span>
              {r.icon && <Icon name={r.icon} size={13} className="faint" />}
              <span className="grow ellipsis">{r.title}</span>
              {r.keys && <span className="kbd">{r.keys}</span>}
            </div>
          ))}
          {!results.length && <div className="empty" style={{ height: 120 }}>Nothing matches “{q}”</div>}
        </div>
      </div>
    </div>
  );
}
