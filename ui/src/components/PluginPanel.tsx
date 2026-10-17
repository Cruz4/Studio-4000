import { useEffect, useMemo, useState } from "react";
import { act, closePlugin, loadCatalogue, openPlugin, toast, useStore } from "../store";
import type { CatalogueEntry, Plugin } from "../types";
import { cx } from "../util";
import { PluginWindow } from "./fx/PluginWindow";
import { Icon, Modal } from "./ui";

function findPlugin(id: string | null): { plugin: Plugin; owner: string } | null {
  const p = useStore.getState().project;
  if (!p || !id) return null;
  for (const t of p.tracks) for (const pl of t.plugins) if (pl.id === id) return { plugin: pl, owner: t.name };
  for (const pl of p.master.plugins) if (pl.id === id) return { plugin: pl, owner: "Master" };
  return null;
}

export function PluginPanel() {
  const ids = useStore((s) => s.openPlugins);
  const project = useStore((s) => s.project);
  const open = useMemo(() => ids.map((id) => findPlugin(id)).filter((x): x is { plugin: Plugin; owner: string } => !!x), [ids, project]);
  if (!open.length) return null;
  return (
    <>
      {open.map(({ plugin, owner }) => (
        <PluginWindow key={plugin.id} plugin={plugin} owner={owner} onClose={() => closePlugin(plugin.id)} />
      ))}
    </>
  );
}

const CATEGORY_ORDER = ["Drums & Percussion", "Bass", "Keys", "Pads & Strings", "Leads & Plucks", "Instrument",
  "Pitch", "EQ", "Dynamics", "Reverb", "Delay", "Modulation", "Saturation", "Filter", "Stereo", "Console", "Utility", "Dither"];

export function PluginPicker() {
  const picker = useStore((s) => s.picker);
  const catalogue = useStore((s) => s.catalogue);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");
  const [idx, setIdx] = useState(0);

  useEffect(() => { if (picker && !catalogue.length) loadCatalogue(); setQ(""); setIdx(0); setCat("All"); }, [picker]);

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return catalogue
      .filter((c) => (picker?.synth ? c.synth : true))
      .filter((c) => cat === "All" || c.category === cat || (cat === "VST3" && c.format !== "Built-in"))
      .filter((c) => words.every((w) => `${c.name} ${c.vendor} ${c.category} ${c.format}`.toLowerCase().includes(w)))
      .sort((a, b) => Number(a.format === "Built-in" && a.vendor === "Airwindows") - Number(b.format === "Built-in" && b.vendor === "Airwindows") || a.name.localeCompare(b.name));
  }, [catalogue, q, cat, picker]);

  if (!picker) return null;
  const close = () => useStore.setState({ picker: null });
  const pool = catalogue.filter((c) => (picker.synth ? c.synth : true));
  const cats = ["All", ...CATEGORY_ORDER.filter((c) => pool.some((x) => x.category === c)), ...(pool.some((c) => c.format !== "Built-in") ? ["VST3"] : [])];

  const choose = async (c: CatalogueEntry) => {
    close();
    if (picker.clipId) {
      if (c.synth) return toast("Instruments go on the track. Clip effects are for this audio clip.", "warning");
      const r = await act("plugin.add", { clipId: picker.clipId, plugin: c.id }) as { id?: string } | undefined;
      if (r?.id) openPlugin(r.id);
      return;
    }
    if (c.synth) {
      const track = useStore.getState().project?.tracks.find((t) => t.id === picker.trackId);
      let id = track?.kind === "instrument" ? track.id : undefined;
      if (!id) id = (await act("track.add", { kind: "instrument", name: c.name }))?.[0];
      if (!id) return;
      useStore.setState({ selectedTrack: id, bottom: "effects" });
      const added = await act("plugin.add", { trackId: id, plugin: c.id }) as { id?: string } | undefined;
      if (added?.id) openPlugin(added.id);
      return;
    }
    const r = await act("plugin.add", { trackId: picker.trackId, plugin: c.id });
    if (r?.id) openPlugin(r.id);
  };

  return (
    <Modal title={picker.synth ? "Choose an instrument" : "Add an effect"} onClose={close} width={760}>
      <div className="row">
        <input className="input grow" autoFocus placeholder="Search effects and instruments (name, maker, type)…" value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(list.length - 1, i + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            if (e.key === "Enter" && list[idx]) choose(list[idx]);
          }} />
        <button className="btn" onClick={() => act("plugins.scan")} title="Scan the plug-in folders for new plug-ins"><Icon name="search" size={13} /> Scan VSTs</button>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
        {cats.map((c) => <button key={c} className={cx("btn sm", cat === c && "on")} onClick={() => { setCat(c); setIdx(0); }}>{c}</button>)}
      </div>
      <div style={{ maxHeight: "52vh", overflow: "auto", margin: "0 -6px" }}>
        {list.map((c, i) => (
          <div key={c.id} className={cx("palette-item", i === idx && "on")} onMouseEnter={() => setIdx(i)} onClick={() => choose(c)}>
            <Icon name={c.synth ? "piano" : c.format === "Built-in" ? "wand" : "plug"} size={14} />
            <span className="grow ellipsis">{c.name}</span>
            <span className="small faint">{c.vendor}</span>
            <span className="pill">{c.category || "Effect"}</span>
            <span className="pill">{c.format}</span>
          </div>
        ))}
        {!list.length && <div className="empty">Nothing matches. Scan for VST3 plug-ins or try another word.</div>}
      </div>
    </Modal>
  );
}
