import { useEffect, useRef, useState } from "react";
import { useMeterCanvas } from "../meters";
import { type Choice, inputChoices, outputChoices } from "../io";
import { openTrackMenu, createTrackItems, openFormatMenu } from "../trackMenu";
import { act, type Devices, loadDevices, openPlugin, selectPlugin, selectTrack, useStore } from "../store";
import type { Plugin, Project, Track } from "../types";
import { clamp, cx, dbToFader, faderToDb, formatDb, shade } from "../util";
import { toggleTrackFx, trackFxOn } from "../commands";
import { openMenu } from "./ContextMenu";
import { accentFor, shortName } from "./fx/registry";
import { beginPluginReorder } from "../pluginReorder";
import { beginTrackReorder } from "../trackReorder";
import { DbField, Icon, Knob, startDrag } from "./ui";

/** Constant 5 dB steps, so every printed gap is the same height. The dock keeps every 15 dB. */
const FULL_MARKS = [15, 10, 5, 0, -5, -10, -15, -20, -25, -30, -35, -40, -45, -50, -55, -60, -100];
const DOCK_MARKS = [15, 0, -15, -30, -45, -60, -100];

function markLabel(db: number) {
  if (db <= -99) return "−∞";
  return db > 0 ? `+${db}` : String(db);
}

/** Same travel as the fader cap, so a printed number sits level with that gain. */
function markTop(db: number) {
  const pos = dbToFader(db);
  return `calc(6px + ${(1 - pos) * 100}% - ${(1 - pos) * 12}px)`;
}

function FaderScale({ marks }: { marks: number[] }) {
  return (
    <div className="fader-scale" aria-hidden>
      {marks.map((db) => <span key={db} className={db >= 0 ? "hot" : undefined} style={{ top: markTop(db) }}>{markLabel(db)}</span>)}
    </div>
  );
}

function Fader({ db, onChange, onCommit }: { db: number; onChange: (db: number) => void; onCommit?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = dbToFader(db);
  return (
    <div className="fader" ref={ref} title={`${formatDb(db)} dB. Double-click for 0 dB, Shift for fine control`}
      onDoubleClick={() => { onChange(0); onCommit?.(); }}
      onPointerDown={(e) => {
        if (e.detail > 1) { onChange(0); onCommit?.(); return; }
        const h = ref.current!.clientHeight - 12;
        const start = pos;
        startDrag(e, (_dx, dy, ev) => onChange(faderToDb(clamp(start - dy / (ev.shiftKey ? h * 4 : h), 0, 1))), () => onCommit?.());
      }}
      onWheel={(e) => onChange(clamp(db + (e.deltaY < 0 ? 0.5 : -0.5), -100, 15))}>
      <div className="track" />
      <div className="unity" style={{ top: markTop(0) }} />
      <div className="cap" style={{ top: markTop(db) }} />
    </div>
  );
}

function Meter({ id, onReset }: { id: string; onReset?: () => void }) {
  const ref = useMeterCanvas(id);
  return <canvas ref={ref} className="meter-v" title={onReset ? "Level. Double-click to set 0 dB" : "Level of this track"} onDoubleClick={onReset} />;
}

export function SynthSlot({ p, trackId, compact }: { p: Plugin; trackId: string; compact?: boolean }) {
  const open = useStore((s) => s.openPlugins.includes(p.id));
  const selected = useStore((s) => s.selectedPlugin === p.id);
  return (
    <div className={cx("slot synth", compact && "compact", selected && "selected", open && "open")} style={{ ["--accent" as string]: "#00d1ff" }} data-plugin={p.id} data-plugin-index={0}
      onClick={(e) => { e.stopPropagation(); selectPlugin(p.id); }}
      onDoubleClick={(e) => { e.stopPropagation(); openPlugin(p.id, e.currentTarget); }}
      onContextMenu={(e) => openMenu(e, [
        ...(p.hasEditor ? [{ label: "Open instrument window", icon: "window", run: () => act("plugin.openEditor", { id: p.id }) }] : []),
        { label: "Replace instrument…", icon: "piano", run: () => useStore.setState({ picker: { trackId, synth: true } }) },
      ])} title={`Instrument: ${p.name}`}>
      <Icon name="piano" size={11} /><span className="ellipsis grow">{compact ? shortName(p) : p.name}</span>
      {open && <span className="slot-open" title="This instrument's window is open" />}
    </div>
  );
}

/** Bypasses all of a track's inserts at once (and brings back the ones that were on). */
export function FxToggle({ trackId, plugins }: { trackId: string; plugins: Plugin[] }) {
  const inserts = plugins.filter((x) => !x.synth);
  const on = trackFxOn(plugins);
  return (
    <button className={cx("toggle fx", on && "on", !inserts.length && "no-fx")} onClick={(e) => { e.stopPropagation(); toggleTrackFx(trackId); }}
      title={!inserts.length ? "No effects yet" : on ? "Effects on. Click to bypass all of this track's effects (Shift+F)" : "Effects bypassed. Click to turn them back on (Shift+F)"}>FX</button>
  );
}

export function InsertSlot({ p, index, compact }: { p: Plugin; index: number; compact?: boolean }) {
  const open = useStore((s) => s.openPlugins.includes(p.id));
  const selected = useStore((s) => s.selectedPlugin === p.id);
  return (
    <div className={cx("slot", compact && "compact", !p.enabled && "off", selected && "selected", open && "open")} style={{ ["--accent" as string]: accentFor(p) }}
      data-plugin={p.id} data-plugin-index={index}
      title={`${p.name}${p.vendor ? ` · ${p.vendor}` : ""}. Click to select, double-click to open, drag to reorder. A line shows where it will land.`}
      onPointerDown={(e) => {
        const horizontal = !!e.currentTarget.parentElement?.classList.contains("track-fx-list");
        beginPluginReorder(e, { id: p.id, name: p.name, index, axis: horizontal ? "x" : "y", item: e.currentTarget });
      }}
      onClick={(e) => { e.stopPropagation(); selectPlugin(p.id); }}
      onDoubleClick={(e) => { e.stopPropagation(); openPlugin(p.id, e.currentTarget); }}
      onContextMenu={(e) => { const el = e.currentTarget; selectPlugin(p.id); openMenu(e, [
        { label: "Edit parameters", icon: "settings", run: () => openPlugin(p.id, el) },
        ...(p.hasEditor ? [{ label: "Open plug-in window", icon: "window", run: () => act("plugin.openEditor", { id: p.id }) }] : []),
        { label: p.enabled ? "Bypass" : "Enable", icon: "power", run: () => act("plugin.set", { id: p.id, enabled: !p.enabled }) },
        { label: "Move up", disabled: index === 0, run: () => act("plugin.move", { id: p.id, index: index - 1 }) },
        { label: "Move down", run: () => act("plugin.move", { id: p.id, index: index + 1 }) },
        { separator: true },
        { label: "Remove", icon: "trash", danger: true, run: () => act("plugin.remove", { id: p.id }) },
      ]); }}>
      <button className="toggle slot-power" style={{ background: p.enabled ? "var(--green)" : "rgba(255,255,255,.1)" }}
        title={p.enabled ? "Bypass" : "Enable"} onClick={(e) => { e.stopPropagation(); act("plugin.set", { id: p.id, enabled: !p.enabled }); }} />
      <span className="ellipsis grow">{compact ? shortName(p) : p.name}</span>
      {p.external && !compact && <span className="faint" style={{ fontSize: 9 }}>VST3</span>}
      {open && <span className="slot-open" title="This effect's window is open" />}
    </div>
  );
}

function ChoiceSelect({ value, choices, title, prefix = "", onChange }: { value: string; choices: Choice[]; title: string; prefix?: string; onChange: (v: string) => void }) {
  const groups = [...new Set(choices.map((c) => c.group ?? ""))];
  return (
    <select className="input sm" value={value} title={title} onChange={(e) => onChange(e.target.value)}>
      {groups.map((g) => {
        const opts = choices.filter((c) => (c.group ?? "") === g).map((c) => <option key={c.value} value={c.value}>{prefix}{c.label}</option>);
        return g ? <optgroup key={g} label={g}>{opts}</optgroup> : opts;
      })}
    </select>
  );
}

function panText(p: number) {
  if (Math.abs(p) < 0.005) return "C";
  return p < 0 ? `${Math.round(-p * 100)}L` : `${Math.round(p * 100)}R`;
}

function Strip({ track, project, devices, selected, full }: { track: Track; project: Project; devices: Devices | null; selected: boolean; full?: boolean }) {
  const [vol, setVol] = useState<number | null>(null);
  const [pan, setPan] = useState<number | null>(null);
  const db = vol ?? track.volumeDb ?? 0;
  const p = pan ?? track.pan ?? 0;
  const inserts = track.plugins.filter((x) => !(track.kind === "instrument" && x.synth));
  const synth = track.plugins.find((x) => x.synth);
  const recordable = track.kind === "audio" || track.kind === "instrument";
  const unsentBuses = project.buses.filter((b) => !track.sends.some((s) => s.bus === b.bus) && track.returnBus !== b.bus);

  return (
    <div className={cx("strip", selected && "selected")} data-track={track.id}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (e.ctrlKey || e.metaKey) { selectTrack(track.id, "toggle"); return; }
        selectTrack(track.id);
        if ((e.target as HTMLElement).closest("button, input, select, .slot, .fader, .knob, canvas")) return;
        beginTrackReorder(e, { id: track.id, name: track.name, colour: track.colour, axis: "x", source: e.currentTarget });
      }}
      onContextMenu={(e) => { if ((e.target as HTMLElement).closest(".slot, button, select, input")) return; openTrackMenu(e, track); }}>
      <div className="strip-name" style={{ background: shade(track.colour, 0.3), borderBottom: `2px solid ${track.colour}` }} title={`${track.name}. Drag to reorder. A line shows where it will land.`}>
        <span className="grip" />
        <span className="ellipsis">{track.name}</span>
        {(track.kind === "audio" || track.kind === "group") && (
          <button className="kind" title="Choose stereo or mono" onClick={(e) => openFormatMenu(e, track)}>{track.channels === 1 ? "Mono" : "Stereo"}</button>
        )}
      </div>
      <div className="strip-rack">
      {recordable && (
        <ChoiceSelect value={track.input ?? ""} choices={inputChoices(track, devices)} title="Input"
          onChange={(v) => act("track.setInput", { id: track.id, input: v })} />
      )}
      {synth && <SynthSlot p={synth} trackId={track.id} />}
      {inserts.map((x) => <InsertSlot key={x.id} p={x} index={track.plugins.indexOf(x)} />)}
      <div className="row" style={{ gap: 4 }}>
        <div className="slot add grow" onClick={() => useStore.setState({ picker: { trackId: track.id } })}><Icon name="plus" size={11} /> Insert</div>
        <FxToggle trackId={track.id} plugins={track.plugins} />
      </div>
      {track.sends.map((s) => (
        <div key={s.id} className={cx("slot send", !s.enabled && "off")} title={`Send to ${s.busName}: ${formatDb(s.gainDb)} dB. Scroll to change, right-click for options`}
          onWheel={(e) => act("send.set", { id: s.id, gainDb: clamp(s.gainDb + (e.deltaY < 0 ? 1 : -1), -60, 6) })}
          onContextMenu={(e) => openMenu(e, [
            { label: s.enabled ? "Bypass send" : "Enable send", icon: "power", run: () => act("send.set", { id: s.id, enabled: !s.enabled }) },
            { label: "Set to -12 dB", run: () => act("send.set", { id: s.id, gainDb: -12 }) },
            { label: "Remove send", icon: "trash", danger: true, run: () => act("send.remove", { id: s.id }) },
          ])}>
          <Icon name="send" size={10} /><span className="ellipsis grow">{s.busName}</span>
          <DbField className="mono faint" style={{ fontSize: 10 }} db={s.gainDb} min={-60} max={6} digits={0} onChange={(v) => act("send.set", { id: s.id, gainDb: v })} />
        </div>
      ))}
      {track.kind !== "return" && (
        <div className="slot add" onClick={(e) => openMenu(e, [
          ...unsentBuses.map((b) => ({ label: `Send to ${b.name}`, icon: "send", run: () => act("send.add", { trackId: track.id, bus: b.bus, gainDb: -12 }) })),
          { label: "New reverb return + send", icon: "layers", run: async () => { const bus = await act("bus.create", { name: "Reverb", effect: "reverb" }); if (bus !== undefined) act("send.add", { trackId: track.id, bus, gainDb: -12 }); } },
          { label: "New delay return + send", icon: "layers", run: async () => { const bus = await act("bus.create", { name: "Delay", effect: "delay" }); if (bus !== undefined) act("send.add", { trackId: track.id, bus, gainDb: -14 }); } },
        ])}><Icon name="plus" size={11} /> Send</div>
      )}
      </div>
      <div className="strip-pan">
        <Knob value={(p + 1) / 2} bipolar size={full ? 32 : 22} title={`Pan ${panText(p)}. Double-click to centre`}
          onChange={(v) => { const np = Math.round((v * 2 - 1) * 100) / 100; setPan(np); act("track.set", { id: track.id, pan: np }); }}
          onCommit={() => setPan(null)} onReset={() => act("track.set", { id: track.id, pan: 0 })} />
        <span className="pan-read mono">{panText(p)}</span>
      </div>
      <div className="strip-controls">
        <div className="strip-toggles">
          <button className={cx("toggle mute", track.mute && "on")} title="Mute" onClick={() => act("track.set", { id: track.id, mute: !track.mute })}>M</button>
          <button className={cx("toggle solo", track.solo && "on")} title="Solo" onClick={() => act("track.set", { id: track.id, solo: !track.solo })}>S</button>
          {recordable && <button className={cx("toggle arm", track.armed && "on")} title="Arm for recording" onClick={() => act("track.arm", { id: track.id, armed: !track.armed })}>●</button>}
        </div>
      </div>
      <div className="fader-area">
        <FaderScale marks={full ? FULL_MARKS : DOCK_MARKS} />
        <Fader db={db} onChange={(v) => { setVol(v); act("track.set", { id: track.id, volumeDb: v }); }} onCommit={() => setVol(null)} />
        <Meter id={track.id} onReset={() => { setVol(null); act("track.set", { id: track.id, volumeDb: 0 }); }} />
      </div>
      <div className="strip-db mono"><DbField db={db} min={-100} max={15} onChange={(v) => { setVol(null); act("track.set", { id: track.id, volumeDb: v }); }} /> dB</div>
      <ChoiceSelect value={track.output ?? "master"} choices={outputChoices(track, project, devices)} title="Output" prefix="→ "
        onChange={(v) => act("track.set", { id: track.id, output: v })} />
    </div>
  );
}

function MasterStrip({ project, devices, full }: { project: Project; devices: Devices | null; full?: boolean }) {
  const [vol, setVol] = useState<number | null>(null);
  const db = vol ?? project.master.volumeDb ?? 0;
  const outs = devices?.outputs ?? [];
  return (
    <div className="strip master" data-track="master">
      <div className="strip-name" style={{ background: "linear-gradient(90deg, rgba(124,92,255,.4), rgba(0,209,255,.3))" }}>Master</div>
      <div className="strip-rack">
        {project.master.plugins.map((p, i) => <InsertSlot key={p.id} p={p} index={i} />)}
        <div className="row" style={{ gap: 4 }}>
          <div className="slot add grow" onClick={() => useStore.setState({ picker: { trackId: "master" } })}><Icon name="plus" size={11} /> Insert</div>
          <FxToggle trackId="master" plugins={project.master.plugins} />
        </div>
      </div>
      <div className="strip-controls">
        {outs.length > 1 ? (
          <ChoiceSelect value={devices?.masterOutput ?? outs[0]} choices={outs.map((o) => ({ value: o, label: o }))} title="Speakers the master bus plays through" prefix="🔊 "
            onChange={(v) => act("devices.setMasterOutput", { name: v }).then(() => loadDevices())} />
        ) : <span className="section-title ellipsis" title={outs[0]}>{outs[0] ?? "Stereo out"}</span>}
      </div>
      <div className="fader-area">
        <FaderScale marks={full ? FULL_MARKS : DOCK_MARKS} />
        <Fader db={db} onChange={(v) => { setVol(v); act("master.set", { volumeDb: v }); }} onCommit={() => setVol(null)} />
        <Meter id="master" onReset={() => { setVol(null); act("master.set", { volumeDb: 0 }); }} />
      </div>
      <div className="strip-db mono"><DbField db={db} min={-100} max={15} onChange={(v) => { setVol(null); act("master.set", { volumeDb: v }); }} /> dB</div>
      <button className="btn sm strip-foot" onClick={() => useStore.setState({ bottom: "smart" })} title="Analyse the mix and master it to a loudness target"><Icon name="sparkles" size={12} /> Smart Mix</button>
    </div>
  );
}

export function Mixer({ full }: { full?: boolean }) {
  const project = useStore((s) => s.project)!;
  const selected = useStore((s) => s.selectedTrack);
  const selectedTracks = useStore((s) => s.selectedTracks);
  const devices = useStore((s) => s.devices);

  useEffect(() => { loadDevices().catch(() => {}); }, []);

  return (
    <div className={cx("mixer", full && "full")} onContextMenu={(e) => {
      if ((e.target as HTMLElement).closest(".strip")) return;
      openMenu(e, createTrackItems());
    }}>
      {project.tracks.map((t) => <Strip key={t.id} track={t} project={project} devices={devices} selected={selectedTracks.includes(t.id) || (!selectedTracks.length && selected === t.id)} full={full} />)}
      <div className="grow" />
      <MasterStrip project={project} devices={devices} full={full} />
    </div>
  );
}
