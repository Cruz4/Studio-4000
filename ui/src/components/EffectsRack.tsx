// The dock's Effects tab: the selected track's inserts in a horizontal row.
import { useState } from "react";
import { act, toast, useStore } from "../store";
import type { Plugin } from "../types";
import { cx } from "../util";
import { useFx } from "./fx/core";
import { EDITORS, GENERIC, accentFor } from "./fx/registry";
import { ErrorBoundary, Icon } from "./ui";

function EffectCard({ plugin, index, expanded, onToggle }: {
  plugin: Plugin; index: number; expanded: boolean; onToggle: () => void;
}) {
  const fx = useFx(plugin.id, plugin.params);
  const entry = EDITORS[plugin.type];
  const accent = accentFor(plugin);

  const reorder = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, select, textarea")) return;
    const host = (e.currentTarget as HTMLElement).closest<HTMLElement>(".fx-card");
    const row = host?.parentElement;
    if (!host || !row) return;
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    let dest = index;
    let ghost: HTMLDivElement | null = null;
    const clear = () => row.querySelectorAll(".fx-held, .fx-drop-before, .fx-drop-after").forEach((el) => el.classList.remove("fx-held", "fx-drop-before", "fx-drop-after"));
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!moved) {
        moved = true;
        document.body.classList.add("reordering");
        ghost = document.createElement("div");
        ghost.className = "fx-ghost";
        ghost.innerHTML = "<b></b><small></small>";
        document.body.appendChild(ghost);
      }
      clear();
      host.classList.add("fx-held");
      const cards = [...row.querySelectorAll<HTMLElement>("[data-plugin-index]")];
      const hit = cards.find((c) => {
        const b = c.getBoundingClientRect();
        return ev.clientX >= b.left && ev.clientX < b.right;
      });
      let where = "Pick a spot";
      if (hit?.dataset.pluginIndex != null) {
        const b = hit.getBoundingClientRect();
        const after = ev.clientX > b.left + b.width / 2;
        dest = Number(hit.dataset.pluginIndex) + (after ? 1 : 0);
        hit.classList.add(after ? "fx-drop-after" : "fx-drop-before");
        const name = hit.querySelector(".fx-card-name")?.textContent?.trim() || "this effect";
        where = dest === index ? "Stays here" : after ? `After ${name}` : `Before ${name}`;
      }
      if (ghost) {
        ghost.style.left = `${ev.clientX + 14}px`;
        ghost.style.top = `${ev.clientY + 16}px`;
        ghost.querySelector("b")!.textContent = plugin.name;
        ghost.querySelector("small")!.textContent = where;
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      clear();
      ghost?.remove();
      document.body.classList.remove("reordering");
      if (!moved) onToggle();
      else if (dest !== index) act("plugin.move", { id: plugin.id, index: dest });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className={cx("fx-card", expanded && "open", !plugin.enabled && "off", !plugin.loaded && "missing")}
      data-plugin={plugin.id} data-plugin-index={index} style={{ ["--accent" as string]: accent }}>
      <div className="fx-card-head" onPointerDown={reorder} title="Drag to change the order. Click the name to open or close.">
        <span className="grip" />
        <span className="fx-card-kind">{entry?.kind ?? (plugin.external ? "VST3" : "Effect")}</span>
        <b className="fx-card-name ellipsis grow">{plugin.name}</b>
        <button className={cx("btn sm ghost icon", plugin.enabled && "on")} title={plugin.enabled ? "Bypass" : "Turn on"}
          onClick={() => act("plugin.set", { id: plugin.id, enabled: !plugin.enabled })}><Icon name="power" size={12} /></button>
        <button className="btn sm ghost icon" title={expanded ? "Minimize" : "Open"} onClick={onToggle}>
          <Icon name={expanded ? "chevronDown" : "chevronRight"} size={13} />
        </button>
        <button className="btn sm ghost icon" title="Remove" onClick={() => act("plugin.remove", { id: plugin.id })}><Icon name="trash" size={12} /></button>
      </div>
      {expanded && (
        <div className={cx("fx-card-body", !plugin.enabled && "bypassed")}>
          {!plugin.loaded && <div className="pill err">This plug-in failed to load.</div>}
          <ErrorBoundary name={plugin.name}>
            {entry ? entry.render(fx, plugin.id) : GENERIC.render(fx, plugin.id)}
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}

export function EffectsRack() {
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedTrack);
  const track = project?.tracks.find((t) => t.id === selectedId) ?? project?.tracks[0];
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [hot, setHot] = useState(false);
  if (!project || !track) return <div className="empty">Select a track to see its effects.</div>;

  const inserts = track.plugins.filter((p) => !p.synth).map((p) => ({ p, index: track.plugins.indexOf(p) }));
  const expanded = (id: string, first: boolean) => open[id] ?? first;

  const addAt = async (pluginId: string, name: string, index = -1) => {
    const r = await act("plugin.add", { trackId: track.id, plugin: pluginId, index }) as { id?: string } | undefined;
    if (r?.id) setOpen((s) => ({ ...s, [r.id!]: true }));
    toast(`${name} → ${track.name}`, "success");
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setHot(false);
    const plugin = e.dataTransfer.getData("application/x-s3-plugin");
    const chain = e.dataTransfer.getData("application/x-s3-chain");
    const card = (e.target as HTMLElement).closest<HTMLElement>("[data-plugin-index]");
    const at = card?.dataset.pluginIndex != null ? Number(card.dataset.pluginIndex) : -1;
    if (plugin) {
      const info = JSON.parse(plugin) as { id: string; synth?: boolean; name: string };
      if (info.synth) return toast("Drop effects here. Instruments go on an instrument track.", "warning");
      return addAt(info.id, info.name, at);
    }
    if (chain) act("chain.load", { trackId: track.id, name: chain });
  };

  return (
    <div className="fx-rack">
      <div className="fx-rack-bar">
        <span className="fx-rack-swatch" style={{ background: track.colour }} />
        <b className="ellipsis">{track.name}</b>
        <span className="small faint">{inserts.length ? `${inserts.length} effect${inserts.length === 1 ? "" : "s"}` : "No effects yet"}</span>
        <div className="grow" />
        <button className="btn sm" onClick={() => useStore.setState({ picker: { trackId: track.id } })}><Icon name="plus" size={12} /> Add effect</button>
      </div>
      <div className={cx("fx-rack-row", hot && "hot")}
        onDragOver={(e) => {
          const types = [...e.dataTransfer.types];
          if (!types.includes("application/x-s3-plugin") && !types.includes("application/x-s3-chain")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setHot(true);
        }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setHot(false); }}
        onDrop={onDrop}>
        {inserts.map(({ p, index }, i) => (
          <EffectCard key={p.id} plugin={p} index={index} expanded={expanded(p.id, i === 0)}
            onToggle={() => setOpen((s) => ({ ...s, [p.id]: !expanded(p.id, i === 0) }))} />
        ))}
        <button className="fx-rack-add" onClick={() => useStore.setState({ picker: { trackId: track.id } })}>
          <Icon name="plus" size={16} />
          <span>Drop an effect here</span>
        </button>
      </div>
    </div>
  );
}
