import { useEffect, useMemo, useState } from "react";
import { rpc } from "../bridge";
import { importAudio, selectedTrack } from "../commands";
import { act, type BrowserTab, loadCatalogue, openPlugin, toast, useStore } from "../store";
import type { CatalogueEntry } from "../types";
import { cx } from "../util";
import { Icon, Spinner, Tabs } from "./ui";

const GROUP_ORDER = ["Pitch", "EQ", "Dynamics", "Saturation", "Reverb", "Delay", "Modulation", "Stereo",
  "Drums & Percussion", "Bass", "Keys", "Pads & Strings", "Leads & Plucks", "Instrument"];

export function Browser() {
  const catalogue = useStore((s) => s.catalogue);
  const scanning = useStore((s) => s.scanning);
  const project = useStore((s) => s.project);
  const tab = useStore((s) => s.browserTab);
  const setTab = (t: BrowserTab) => useStore.setState({ browserTab: t });
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [media, setMedia] = useState<{ file: string; name: string; folder: string; size: number }[]>([]);
  const [chains, setChains] = useState<string[]>([]);
  const [favs, setFavs] = useState<Set<string>>(new Set());

  useEffect(() => { if (!catalogue.length) loadCatalogue().catch(() => {}); }, []);
  useEffect(() => {
    rpc<string>("settings.get", { key: "favoritePlugins" }).then((v) => { try { setFavs(new Set(JSON.parse(v || "[]"))); } catch { /* ignore */ } }).catch(() => {});
  }, []);
  const toggleFav = (id: string) => {
    const next = new Set(favs);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFavs(next);
    rpc("settings.set", { key: "favoritePlugins", value: JSON.stringify([...next]) }).catch(() => {});
  };
  useEffect(() => {
    if (tab === "media") rpc("media.list").then(setMedia).catch(() => {});
    if (tab === "chains") rpc("chain.list").then((c: { name: string }[] | string[]) => setChains(c.map((x) => (typeof x === "string" ? x : x.name)))).catch(() => {});
  }, [tab, project?.tracks.length]);

  const groups = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = catalogue.filter((c) => (tab === "inst" ? c.synth : !c.synth))
      .filter((c) => words.every((w) => `${c.name} ${c.vendor} ${c.category} ${c.format}`.toLowerCase().includes(w)));
    const map = new Map<string, CatalogueEntry[]>();
    for (const c of list) {
      const g = c.format !== "Built-in" ? `${c.format} · ${c.vendor || "Other"}` : c.vendor === "Airwindows" ? `Airwindows · ${c.category}` : c.category;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(c);
    }
    const rank = (g: string) => {
      const i = GROUP_ORDER.indexOf(g);
      return g.startsWith("Airwindows") ? 2000 : g.includes(" · ") ? 1000 : i < 0 ? 500 : i;
    };
    const sorted = [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
    const starred = list.filter((c) => favs.has(c.id));
    return starred.length ? [["★ Favorites", starred] as [string, CatalogueEntry[]], ...sorted] : sorted;
  }, [catalogue, q, tab, favs]);

  const addTo = async (c: CatalogueEntry) => {
    if (c.synth) {
      const current = selectedTrack();
      let id = current?.kind === "instrument" ? current.id : undefined;
      if (!id) id = (await act("track.add", { kind: "instrument", name: c.name }))?.[0];
      if (!id) return;
      useStore.setState({ selectedTrack: id, bottom: "effects" });
      const added = await act("plugin.add", { trackId: id, plugin: c.id }) as { id?: string } | undefined;
      const name = useStore.getState().project?.tracks.find((x) => x.id === id)?.name ?? c.name;
      if (added?.id) openPlugin(added.id);
      toast(`${c.name} → ${name}`, "success");
      return;
    }
    const t = selectedTrack();
    if (!t) return toast("Select a track first", "warning");
    const r = await act("plugin.add", { trackId: t.id, plugin: c.id });
    if (r?.id) { toast(`${c.name} → ${t.name}`, "success"); openPlugin(r.id); }
  };

  const collapsedByDefault = (g: string) => g.startsWith("Airwindows") && !q;

  return (
    <div className="browser">
      <div className="browser-head">
        <div className="row" style={{ gap: 4 }}>
          <Tabs value={tab} onChange={setTab} items={[{ id: "fx", label: "Effects" }, { id: "inst", label: "Instruments" }, { id: "media", label: "Media" }, { id: "chains", label: "Chains" }]} />
          <div className="grow" />
          <button className="btn sm ghost icon" title="Hide the browser for more room (B)" onClick={() => useStore.setState({ browserOpen: false })}><Icon name="chevronLeft" size={14} /></button>
        </div>
        {(tab === "fx" || tab === "inst") && (
          <div className="row">
            <input className="input sm grow" placeholder={`Search ${tab === "fx" ? "effects" : "instruments"}…`} value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn sm icon" title="Scan for VST plug-ins (runs in a separate process, so a crashing plug-in can't take the app down)" onClick={() => act("plugins.scan")}>
              {scanning ? <Spinner size={12} /> : <Icon name="search" size={12} />}
            </button>
          </div>
        )}
        {scanning && <div className="col" style={{ gap: 4 }}><span className="small faint ellipsis">Scanning {scanning.current ?? "…"}</span><div className="progress"><div style={{ width: `${(scanning.progress ?? 0) * 100}%` }} /></div></div>}
      </div>
      <div className="browser-list">
        {(tab === "fx" || tab === "inst") && groups.map(([g, items]) => {
          const isOpen = open[g] ?? !collapsedByDefault(g);
          return (
            <div key={g}>
              <div className="b-group row section-title" style={{ cursor: "pointer" }} onClick={() => setOpen({ ...open, [g]: !isOpen })}>
                <Icon name={isOpen ? "chevronDown" : "chevronRight"} size={12} /> <span className="grow">{g}</span><span>{items.length}</span>
              </div>
              {isOpen && items.map((c) => (
                <div key={c.id} className="b-item" draggable title={`${c.name} · ${c.vendor}. Drag onto a track, or double-click to add to the selected track`}
                  onDragStart={(e) => { e.dataTransfer.setData("application/x-s3-plugin", JSON.stringify({ id: c.id, synth: c.synth, name: c.name })); e.dataTransfer.effectAllowed = "copy"; }}
                  onDoubleClick={() => addTo(c)}>
                  <Icon name={c.synth ? "piano" : c.format === "Built-in" ? "wand" : "plug"} size={13} />
                  <span className="grow ellipsis">{c.name.replace(/^AW /, "")}</span>
                  {c.format !== "Built-in" && <span className="badge">{c.format}</span>}
                  <button className={cx("btn sm ghost icon fav", favs.has(c.id) && "on")} title={favs.has(c.id) ? "Remove from favorites" : "Add to favorites"}
                    onClick={(e) => { e.stopPropagation(); toggleFav(c.id); }}>{favs.has(c.id) ? "★" : "☆"}</button>
                  <button className="btn sm ghost icon" title="Add to selected track" onClick={() => addTo(c)}><Icon name="plus" size={11} /></button>
                </div>
              ))}
            </div>
          );
        })}
        {(tab === "fx" || tab === "inst") && !groups.length && (
          <div className="empty"><span>No matches.</span><button className="btn sm" onClick={() => act("plugins.scan")}>Scan plug-in folders</button></div>
        )}

        {tab === "media" && (
          <>
            <button className="btn sm" style={{ width: "100%", marginBottom: 6 }} onClick={() => importAudio()}><Icon name="folder" size={12} /> Import audio…</button>
            {["Audio", "Imported", "Bounces"].map((folder) => {
              const items = media.filter((m) => m.folder === folder);
              if (!items.length) return null;
              return (
                <div key={folder}>
                  <div className="b-group section-title">{folder === "Audio" ? "Recordings" : folder}</div>
                  {items.map((m) => (
                    <div key={m.file} className="b-item" draggable title={`${m.file}\nDrag onto the timeline`}
                      onDragStart={(e) => { e.dataTransfer.setData("application/x-s3-media", m.file); e.dataTransfer.effectAllowed = "copy"; }}
                      onDoubleClick={() => { const t = selectedTrack(); if (t?.kind === "audio") act("clip.importAudio", { trackId: t.id, file: m.file }); }}>
                      <Icon name="wave" size={13} /><span className="grow ellipsis">{m.name}</span><span className="small faint">{(m.size / 1048576).toFixed(1)} MB</span>
                    </div>
                  ))}
                </div>
              );
            })}
            {!media.length && <div className="empty"><span>Recordings, imports and bounces of this project appear here.</span></div>}
          </>
        )}

        {tab === "chains" && (
          <>
            {chains.map((c) => (
              <div key={c} className={cx("b-item")} draggable title="Drag onto a track, or double-click to load onto the selected track"
                onDragStart={(e) => e.dataTransfer.setData("application/x-s3-chain", c)}
                onDoubleClick={() => { const t = selectedTrack(); if (t) act("chain.load", { trackId: t.id, name: c }); }}>
                <Icon name="layers" size={13} /><span className="grow ellipsis">{c}</span>
              </div>
            ))}
            {!chains.length && <div className="empty"><span>Save a track's effects as a chain from its ⋯ menu, then reuse it on any track.</span></div>}
          </>
        )}
      </div>
    </div>
  );
}
