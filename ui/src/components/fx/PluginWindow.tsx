// The floating plug-in window: picks the dedicated editor for each effect type, with a full parameter list as a second tab.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { act, useStore } from "../../store";
import type { Plugin } from "../../types";
import { cx } from "../../util";
import { ErrorBoundary, Icon } from "../ui";
import { useFx } from "./core";
import { EDITORS, GENERIC, accentFor } from "./registry";

export function PluginWindow({ plugin, owner, onClose }: { plugin: Plugin; owner: string; onClose: () => void }) {
  const fx = useFx(plugin.id, plugin.params);
  const entry = EDITORS[plugin.type];
  const [tab, setTab] = useState<"editor" | "params">(entry ? "editor" : "params");
  const width = entry?.width ?? 640;
  const [pos, setPos] = useState(() => {
    const i = Math.max(0, useStore.getState().openPlugins.indexOf(plugin.id));
    return { x: Math.max(12, (window.innerWidth - width) / 2 + i * 28), y: Math.max(56, window.innerHeight * 0.12 + i * 28) };
  });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const project = useStore((s) => s.project);
  const tracks = project?.tracks.filter((t) => t.kind !== "return") ?? [];
  const canReset = fx.params.some((p) => p.def !== undefined);
  const ping = useStore((s) => s.pluginPings[plugin.id] ?? 0);
  const stack = useStore((s) => Math.max(0, s.openPlugins.indexOf(plugin.id)));
  const accent = accentFor(plugin);
  const host = project?.tracks.find((t) => t.plugins.some((p) => p.id === plugin.id));
  const live = !!host?.live && !plugin.synth;

  const anchor = useStore((s) => s.pluginAnchors[plugin.id] ?? null);
  const ref = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState<number | undefined>();

  useEffect(() => { setTab(entry ? "editor" : "params"); }, [plugin.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every open (including re-clicking the slot of an open effect) places the window next to the slot that opened it,
  // never on top of it, so the highlighted slot and the window can be seen together.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const body = el.querySelector<HTMLElement>(".fx-window-body");
    const natural = body ? el.offsetHeight - body.clientHeight + body.scrollHeight : el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight, w = Math.min(width, vw - 24);
    const gap = 14, top = 48, minH = 280;
    const clampX = (x: number) => Math.min(Math.max(12, x), Math.max(12, vw - w - 12));
    if (!anchor) {
      setMaxH(undefined);
      setPos((p) => ({ x: clampX(p.x), y: Math.min(Math.max(top, p.y), Math.max(top, vh - 200)) }));
      return;
    }
    const x = clampX((anchor.left + anchor.right) / 2 - w / 2);
    const above = anchor.top - gap - top, below = vh - 12 - anchor.bottom - gap;
    if (above >= Math.min(natural, minH) && (above >= natural || above >= below)) {
      const h = Math.min(natural, above);
      setMaxH(h); setPos({ x, y: anchor.top - gap - h });
    } else if (below >= Math.min(natural, minH)) {
      setMaxH(Math.min(natural, below)); setPos({ x, y: anchor.bottom + gap });
    } else {
      const fitsRight = vw - 12 - anchor.right - gap >= w;
      setMaxH(undefined);
      setPos({ x: fitsRight ? anchor.right + gap : clampX(anchor.left - gap - w), y: Math.max(top, Math.min(vh - natural - 12, anchor.top - natural / 2)) });
    }
  }, [ping]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const keep = () => setPos((p) => ({ x: Math.min(p.x, Math.max(0, window.innerWidth - 120)), y: Math.min(p.y, Math.max(0, window.innerHeight - 60)) }));
    window.addEventListener("resize", keep);
    return () => window.removeEventListener("resize", keep);
  }, []);

  return (
    <div className="fx-window" ref={ref} style={{ left: pos.x, top: pos.y, width: Math.min(width, window.innerWidth - 24), maxHeight: maxH, zIndex: 80 + stack, ["--accent" as string]: accent }}
      onPointerDown={() => useStore.setState((s) => ({ selectedPlugin: plugin.id, openPlugins: s.openPlugins.includes(plugin.id) ? [...s.openPlugins.filter((x) => x !== plugin.id), plugin.id] : s.openPlugins }))}>
      <div key={ping} className="fx-flash" />
      <div className="fx-window-head"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button,select,input")) return;
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPos({ x: Math.min(window.innerWidth - 120, Math.max(-width + 160, e.clientX - drag.current.dx)), y: Math.min(window.innerHeight - 50, Math.max(0, e.clientY - drag.current.dy)) });
        }}
        onPointerUp={() => (drag.current = null)}>
        <span className="fx-window-badge">{entry?.kind ?? (plugin.external ? "VST3" : plugin.synth ? "Instrument" : "Effect")}</span>
        <div className="col grow" style={{ gap: 0, minWidth: 0 }}>
          <b className="ellipsis">{plugin.name}</b>
          <span className="small faint ellipsis">{owner} · {plugin.vendor || "Built-in"}</span>
        </div>
        {live && host && (
          <span className="fx-live" title={`${host.input || "The input"} is passing through ${host.name}'s effects even while stopped, because the track is ${
            host.monitor === "on" ? "set to monitor its input" : "armed"}. Set its monitor button to Off (or disarm it) to silence it.`}>
            <i /> Live input
          </span>
        )}
        {entry && (
          <div className="fx-seg small">
            <button className={cx(tab === "editor" && "on")} onClick={() => setTab("editor")}>Editor</button>
            <button className={cx(tab === "params" && "on")} onClick={() => setTab("params")}>All parameters</button>
          </div>
        )}
        {plugin.canSidechain && (
          <select className="input sm" style={{ width: 130 }} value={plugin.sidechain ?? ""} title="Sidechain input"
            onChange={(e) => act("plugin.setSidechain", { id: plugin.id, sourceTrackId: e.target.value })}>
            <option value="">No sidechain</option>
            {tracks.map((t) => <option key={t.id} value={t.id}>Key: {t.name}</option>)}
          </select>
        )}
        {plugin.hasEditor && (
          <button className="btn sm" onClick={() => act("plugin.openEditor", { id: plugin.id })} title="Open the plug-in's own window"><Icon name="window" size={12} /> Plug-in UI</button>
        )}
        {canReset && <button className="btn sm ghost" onClick={fx.resetAll} title="Reset every control to its default"><Icon name="undo" size={12} /> Reset</button>}
        <button className={cx("btn sm fx-power", plugin.enabled && "on")} onClick={() => act("plugin.set", { id: plugin.id, enabled: !plugin.enabled })}
          title={plugin.enabled ? "Bypass" : "Turn on"}>
          <Icon name="power" size={12} />
        </button>
        <button className="btn ghost icon sm" onClick={onClose} title="Close"><Icon name="x" size={14} /></button>
      </div>
      {!plugin.loaded && <div className="pill err" style={{ margin: 12 }}>This plug-in failed to load. It may be missing or blocked.</div>}
      <div className={cx("fx-window-body", !plugin.enabled && "bypassed")}>
        <ErrorBoundary key={`${plugin.id}-${tab}`} name={plugin.name}>
          {tab === "editor" && entry ? entry.render(fx, plugin.id) : GENERIC.render(fx, plugin.id)}
        </ErrorBoundary>
      </div>
    </div>
  );
}
