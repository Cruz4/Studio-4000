// The dock's Effects tab: track effects and the selected audio clip's own chain.
import { useEffect, useRef, useState } from "react";
import { rpc } from "../bridge";
import { beginPluginReorder, FX_COPY } from "../pluginReorder";
import { act, openPlugin, toast, useStore } from "../store";
import type { Plugin } from "../types";
import { cx } from "../util";
import { askText } from "./Ask";
import { openMenu } from "./ContextMenu";
import { CompactEditor } from "./fx/CompactEditor";
import { useFx } from "./fx/core";
import { EDITORS, GENERIC, accentFor } from "./fx/registry";
import { ErrorBoundary, Icon } from "./ui";

let copiedFx: string[] = [];

function EffectBody({ plugin, open }: { plugin: Plugin; open: boolean }) {
  const fx = useFx(plugin.id, plugin.params);
  const entry = EDITORS[plugin.type];
  return (
    <div className={cx("fx-col-body", !plugin.enabled && "bypassed")}>
      {!plugin.loaded && <div className="pill err">This plug-in failed to load.</div>}
      <ErrorBoundary name={plugin.name}>
        {open
          ? (entry ? entry.render(fx, plugin.id, plugin.type) : GENERIC.render(fx, plugin.id, plugin.type))
          : <CompactEditor fx={fx} type={plugin.type} />}
      </ErrorBoundary>
    </div>
  );
}

function EffectColumn({ plugin, index, open, selected, order, picked, onToggle, onSelect, onCopied, onRemove, onPaste }: {
  plugin: Plugin; index: number; open: boolean; selected: boolean; order: string[]; picked: string[];
  onToggle: () => void; onSelect: (id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => string[];
  onCopied: (id: string) => void; onRemove: (ids: string[]) => void; onPaste: () => void;
}) {
  const accent = accentFor(plugin);
  const entry = EDITORS[plugin.type];
  const dragIds = useRef<string[]>([plugin.id]);
  const dragged = useRef(false);
  const group = () => (picked.includes(plugin.id) ? order.filter((id) => picked.includes(id)) : [plugin.id]);
  const reorder = (e: React.PointerEvent, ids: string[]) => {
    const host = (e.currentTarget as HTMLElement).closest<HTMLElement>(".fx-col");
    if (!host || e.ctrlKey || e.metaKey || e.shiftKey) return;
    beginPluginReorder(e, {
      id: plugin.id, name: plugin.name, index, axis: "x", item: host, ids, order,
    });
  };
  const menu = (e: React.MouseEvent) => {
    const ids = group();
    openMenu(e, [
      { label: plugin.enabled ? "Bypass" : "Turn on", icon: "power", run: () => act("plugin.set", { id: plugin.id, enabled: !plugin.enabled }) },
      { label: ids.length > 1 ? `Copy ${ids.length}` : "Copy", icon: "copy", run: () => { copiedFx = ids; toast(ids.length > 1 ? `Copied ${ids.length} effects` : `Copied ${plugin.name}`); } },
      { label: "Paste", icon: "copy", disabled: copiedFx.length === 0, run: onPaste },
      { label: ids.length > 1 ? `Duplicate ${ids.length}` : "Duplicate", icon: "copy", run: async () => {
        for (const id of ids) {
          const created = await act("plugin.duplicate", { id }) as { id?: string } | undefined;
          if (created?.id) onCopied(created.id);
        }
      } },
      { label: ids.length > 1 ? `Remove ${ids.length}` : "Remove", icon: "trash", danger: true, run: () => onRemove(ids) },
      { label: "Open window", icon: "window", run: () => openPlugin(plugin.id, e.currentTarget) },
    ]);
  };
  return (
    <div className={cx("fx-col", open && "open", selected && "selected", !plugin.enabled && "off", !plugin.loaded && "missing")}
      data-plugin={plugin.id} data-plugin-index={index} style={{ ["--accent" as string]: accent }}
      onContextMenu={menu}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button, input, select, textarea")) return;
        openPlugin(plugin.id, e.currentTarget);
      }}>
      <div className="fx-col-head" title="Drag the name onto a track to copy this effect. Drag the grip to change the order."
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if ((e.target as HTMLElement).closest("button, .fx-card-name")) return;
          const ids = onSelect(plugin.id, e);
          dragIds.current = ids;
          reorder(e, ids);
        }}>
        <span className="grip" />
        <span className="fx-card-kind">{plugin.synth ? "Instrument" : entry?.kind ?? (plugin.external ? "VST3" : "Effect")}</span>
        <b className="fx-card-name ellipsis grow" title={plugin.name} draggable
          onPointerDown={(e) => { if (e.button !== 0) return; dragIds.current = onSelect(plugin.id, e); }}
          onDragStart={(e) => {
            dragged.current = true;
            const ids = dragIds.current.length ? dragIds.current : [plugin.id];
            e.dataTransfer.setData(FX_COPY, JSON.stringify({ ids }));
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={(e) => {
            if (dragged.current) { dragged.current = false; return; }
            if (e.ctrlKey || e.metaKey || e.shiftKey) return;
            onToggle();
          }}>{plugin.name}</b>
        <button className={cx("fx-power", plugin.enabled && "on")} title={plugin.enabled ? "On — click to bypass" : "Off — click to turn on"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => act("plugin.set", { id: plugin.id, enabled: !plugin.enabled })}><Icon name="power" size={12} /></button>
        <button className="fx-min" title={open ? "Minimize" : "Open"} onPointerDown={(e) => e.stopPropagation()} onClick={onToggle}>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
        </button>
      </div>
      <EffectBody plugin={plugin} open={open} />
    </div>
  );
}

export function EffectsRack() {
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedTrack);
  const selectedClips = useStore((s) => s.selectedClips);
  const editorClip = useStore((s) => s.editorClip);
  const track = project?.tracks.find((t) => t.id === selectedId) ?? project?.tracks[0];
  const rackRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);
  const pickedRef = useRef<string[]>([]);
  const [scope, setScope] = useState<"track" | "clip">("track");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [hot, setHot] = useState(false);
  const [chains, setChains] = useState<{ name: string }[]>([]);
  const refreshChains = () => { void rpc<{ name: string }[]>("chain.list").then(setChains).catch(() => setChains([])); };
  useEffect(refreshChains, [project?.name]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!rackRef.current?.contains(e.target as Node)) rackRef.current?.blur();
    };
    window.addEventListener("pointerdown", down);
    return () => window.removeEventListener("pointerdown", down);
  }, []);

  const pickedClip = project?.tracks.flatMap((t) => t.clips.map((c) => ({ clip: c, track: t })))
    .find((x) => selectedClips.includes(x.clip.id))
    ?? project?.tracks.flatMap((t) => t.clips.map((c) => ({ clip: c, track: t }))).find((x) => x.clip.id === editorClip);
  const audio = pickedClip?.clip.kind === "audio" ? pickedClip : undefined;
  const clipPlugins = audio?.clip.plugins ?? [];
  const inserts = !project || !track ? [] : scope === "clip"
    ? clipPlugins.map((p, index) => ({ p, index }))
    : track.plugins.map((p, index) => ({ p, index }));
  const liveKey = inserts.map((i) => i.p.id).join("\n");
  useEffect(() => {
    const ids = new Set(liveKey ? liveKey.split("\n") : []);
    setPicked((sel) => {
      const next = sel.filter((id) => ids.has(id));
      if (next.length === sel.length) return sel;
      pickedRef.current = next;
      return next;
    });
  }, [liveKey]);

  if (!project || !track) return <div className="empty">Select a track to see its effects.</div>;

  const expanded = (id: string, first: boolean) => open[id] ?? first;
  const target = scope === "clip" && audio ? { clipId: audio.clip.id } : { trackId: track.id };
  const ownerName = scope === "clip" ? (audio ? audio.clip.name : "Clip") : track.name;
  const order = inserts.map((i) => i.p.id);

  const selectEffect = (id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const current = pickedRef.current;
    let next: string[];
    if (e.shiftKey) {
      const from = anchor.current ?? id;
      const a = order.indexOf(from);
      const b = order.indexOf(id);
      if (a < 0 || b < 0) next = [id];
      else {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        next = order.slice(lo, hi + 1);
      }
    } else if (e.ctrlKey || e.metaKey) {
      next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      anchor.current = id;
    } else {
      next = current.includes(id) ? current : [id];
      anchor.current = id;
    }
    pickedRef.current = next;
    setPicked(next);
    rackRef.current?.focus({ preventScroll: true });
    return order.filter((x) => next.includes(x));
  };

  const pasteOnto = async () => {
    if (!copiedFx.length) return toast("Copy an effect first", "warning");
    if (scope === "clip" && !audio) return toast(pickedClip ? "MIDI clips play the track instrument. Clip effects are for audio clips." : "Select an audio clip first", "warning");
    let n = 0;
    for (const id of copiedFx) {
      const created = await act("plugin.duplicate", { id, ...target }) as { id?: string } | undefined;
      if (created?.id) {
        n += 1;
        setOpen((s) => ({ ...s, [created.id!]: true }));
      }
    }
    if (n) toast(n > 1 ? `Pasted ${n} effects onto ${ownerName}` : `Pasted onto ${ownerName}`, "success");
  };

  const removeIds = (ids: string[]) => {
    const live = order.filter((id) => ids.includes(id));
    if (!live.length) return;
    void act("batch.run", { label: live.length > 1 ? "Remove effects" : "Remove effect", calls: live.map((id) => ({ method: "plugin.remove", params: { id } })) });
    setPicked((sel) => {
      const next = sel.filter((id) => !live.includes(id));
      pickedRef.current = next;
      return next;
    });
  };

  const onRackKeys = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      e.stopPropagation();
      const ids = order.filter((id) => picked.includes(id));
      if (!ids.length) return toast("Select an effect first", "warning");
      copiedFx = ids;
      toast(ids.length > 1 ? `Copied ${ids.length} effects` : "Copied");
      return;
    }
    if (mod && e.key.toLowerCase() === "v") {
      e.preventDefault();
      e.stopPropagation();
      void pasteOnto();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (!picked.length) return;
      e.preventDefault();
      e.stopPropagation();
      removeIds(picked);
    }
  };

  const addAt = async (pluginId: string, name: string, index = -1, synth = false) => {
    const r = await act("plugin.add", { ...target, plugin: pluginId, index }) as { id?: string } | undefined;
    if (r?.id) {
      setOpen((s) => ({ ...s, [r.id!]: true }));
      if (synth) openPlugin(r.id);
    }
    toast(`${name} → ${ownerName}`, "success");
  };

  const saveChain = async () => {
    if (scope === "clip" && !audio) return toast("Select an audio clip first", "warning");
    const name = await askText({ title: "Save effect chain", hint: "Saves these effects so you can load them onto another track or clip.", value: `${ownerName} chain`, ok: "Save" });
    if (!name) return;
    await act("chain.save", { ...target, name });
    refreshChains();
    toast(`Saved “${name}”`, "success");
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setHot(false);
    if (scope === "clip" && !audio) return toast(pickedClip ? "MIDI clips play the track instrument. Clip effects are for audio clips." : "Select an audio clip first", "warning");
    const plugin = e.dataTransfer.getData("application/x-s3-plugin");
    const chain = e.dataTransfer.getData("application/x-s3-chain");
    const card = (e.target as HTMLElement).closest<HTMLElement>("[data-plugin-index]");
    const at = card?.dataset.pluginIndex != null ? Number(card.dataset.pluginIndex) : -1;
    if (plugin) {
      const info = JSON.parse(plugin) as { id: string; synth?: boolean; name: string };
      if (info.synth && scope === "clip") return toast("Instruments go on the track. Clip effects are for this audio clip.", "warning");
      if (info.synth && scope === "track") useStore.setState({ selectedTrack: track.id, bottom: "effects" });
      return addAt(info.id, info.name, info.synth ? 0 : at, !!info.synth);
    }
    if (chain) act("chain.load", { ...target, name: chain });
  };

  const note = scope === "clip"
    ? !pickedClip ? "Select an audio clip to edit its own effects."
      : pickedClip.clip.kind !== "audio" ? "MIDI clips play the track instrument. Switch to Track effects, or select an audio clip."
        : null
    : null;

  return (
    <div className="fx-rack" ref={rackRef} tabIndex={0} onKeyDown={onRackKeys}>
      <div className="fx-rack-bar">
        <button className={cx("btn sm", scope === "track" && "on")} onClick={() => { setScope("track"); pickedRef.current = []; setPicked([]); }}>Track effects</button>
        <button className={cx("btn sm", scope === "clip" && "on")} onClick={() => { setScope("clip"); pickedRef.current = []; setPicked([]); }}>Clip effects</button>
        <span className="fx-rack-swatch" style={{ background: (scope === "clip" ? audio?.clip.colour : track.colour) ?? track.colour }} />
        <b className="ellipsis">{scope === "clip" ? (audio ? `${audio.clip.name}` : "No audio clip") : track.name}</b>
        <span className="small faint">{note ? "" : inserts.length ? `${inserts.length}` : "Empty"}</span>
        <div className="grow" />
        <button className="btn sm" disabled={scope === "clip" && !audio} onClick={() => void saveChain()}>Save chain</button>
        <select className="input sm" value="" title="Load a saved effect chain onto this track or clip"
          onFocus={refreshChains}
          onChange={(e) => {
            const name = e.target.value;
            if (!name) return;
            if (scope === "clip" && !audio) return toast("Select an audio clip first", "warning");
            act("chain.load", { ...target, name });
          }}>
          <option value="">Load chain…</option>
          {chains.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <button className="btn sm" disabled={scope === "clip" && !audio}
          onClick={() => useStore.setState({ picker: scope === "clip" && audio ? { trackId: audio.track.id, clipId: audio.clip.id } : { trackId: track.id } })}>
          <Icon name="plus" size={12} /> Add effect
        </button>
      </div>
      {note ? <div className="empty">{note}</div> : (
        <div className={cx("fx-rack-stage", hot && "hot")}
          onDragOver={(e) => {
            const types = [...e.dataTransfer.types];
            if (!types.includes("application/x-s3-plugin") && !types.includes("application/x-s3-chain")) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setHot(true);
          }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setHot(false); }}
          onDrop={onDrop}>
          <div className="fx-rack-chain">
            {inserts.map(({ p, index }, i) => (
              <EffectColumn key={p.id} plugin={p} index={index} open={expanded(p.id, i === 0)}
                selected={picked.includes(p.id)} order={order} picked={picked}
                onToggle={() => setOpen((s) => ({ ...s, [p.id]: !expanded(p.id, i === 0) }))}
                onSelect={selectEffect}
                onCopied={(id) => setOpen((s) => ({ ...s, [id]: true }))}
                onRemove={removeIds}
                onPaste={() => void pasteOnto()} />
            ))}
            <button className="fx-rack-add" disabled={scope === "clip" && !audio}
              onClick={() => useStore.setState({ picker: scope === "clip" && audio ? { trackId: audio.track.id, clipId: audio.clip.id } : { trackId: track.id } })}>
              <Icon name="plus" size={16} />
              <span>{scope === "clip" ? "Drop a clip effect" : "Drop an effect here"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
