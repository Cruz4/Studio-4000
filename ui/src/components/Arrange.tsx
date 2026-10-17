import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { rpc } from "../bridge";
import { reportHover, useCollab } from "../collab";
import { addMidiClip, addTrack, copySelection, crossfadeSelection, cutSelection, importAudio, pasteClips, splitAtPlayhead, splitClipAt, zoomToClips } from "../commands";
import { type Choice, inputChoices, inputLabel, outputChoices, outputLabel } from "../io";
import { useMeterCanvas } from "../meters";
import { act, live, loadDevices, onTick, openPlugin, selectTrack, toast, useStore, type ArrangeTool, type Grid } from "../store";
import { createTrackItems, formatChoices, openFormatMenu, openTrackMenu, toggleAutomation } from "../trackMenu";
import type { AutomationLane, Clip, Project, Track } from "../types";
import { HEADER_W_DEFAULT, TRACK_H_DEFAULT, heightOf, resetTrackHeight, resizeAllTracks, setAllTrackHeights, setHeaderWidth, setTrackHeight, useHeaderWidth, useTrackHeights } from "../trackHeights";
import { useThemeName } from "../theme";
import { clamp, cx, dbToFader, faderToDb, fileToBase64, formatDb, formatRulerTime, gridSeconds, rulerStep, secondsPerBar, shade, snap } from "../util";
import { askText } from "./Ask";
import { ClipGain } from "./ClipGain";
import { openMenu, type MenuItem } from "./ContextMenu";
import { FxToggle, InsertSlot, SynthSlot } from "./Mixer";
import { FX_COPY } from "../pluginReorder";
import { beginTrackReorder } from "../trackReorder";
import { DbField, Icon, startDrag } from "./ui";
import { Waveform } from "./Waveform";

const TOOL_LABEL: Record<ArrangeTool, string> = { move: "Move", time: "Time", split: "Split", slip: "Slip", erase: "Erase" };
const TOOL_HINT: Record<ArrangeTool, string> = {
  move: "Move tool (1): select and drag clips",
  time: "Time tool (2): click to move the playhead, drag to set the loop",
  split: "Split tool (3): click a clip to cut it, or empty space to move the playhead",
  slip: "Slip tool (4): drag the audio inside a clip",
  erase: "Erase tool (5): click a clip to delete it",
};

const AUTO_H = 76;

interface DragPreview {
  ids: string[];
  mode: "move" | "l" | "r" | "fi" | "fo" | "slip";
  dt: number;
  trackDelta: number;
  dy: number;
  copy: boolean;
}

/* ------------------------------------------------------------------ uploads */

export async function uploadAndImport(files: File[], trackId: string | undefined, start: number) {
  const audio = files.filter((f) => /\.(wav|aiff?|flac|ogg|mp3|m4a)$/i.test(f.name));
  if (!audio.length) return toast("Drop audio files (WAV, AIFF, FLAC, OGG, MP3)", "warning");
  let target = trackId;
  let at = start;
  for (const f of audio) {
    if (!target) {
      const ids = await act("track.add", { kind: "audio", name: f.name.replace(/\.[^.]+$/, "") });
      target = ids?.[0];
      if (!target) return;
    }
    toast(`Importing ${f.name}…`);
    const chunk = 3 * 1024 * 1024;
    let path = "";
    for (let off = 0; off < f.size; off += chunk) {
      const data = await fileToBase64(f.slice(off, off + chunk) as File);
      path = await rpc<string>("media.writeFile", { name: f.name, data, append: off > 0 });
    }
    const id = await act("clip.importAudio", { trackId: target, file: path, start: at });
    const clip = useStore.getState().project?.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    if (clip) at = clip.end;
    if (!trackId) target = undefined;
  }
}

/* ------------------------------------------------------------------ ruler */

function Ruler({ project, pps, view, grid }: { project: Project; pps: number; view: { left: number; width: number }; grid: Grid }) {
  const headerW = useHeaderWidth((s) => s.w);
  const theme = useThemeName();
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = view.width, h = 34;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const t0 = view.left / pps, t1 = (view.left + w) / pps;
    const paint = getComputedStyle(document.documentElement);
    const tick = paint.getPropertyValue("--ruler-tick").trim() || "rgba(255,255,255,.35)";
    const text = paint.getPropertyValue("--ruler-text").trim() || "rgba(232,234,242,.8)";
    const step = rulerStep(pps);
    const sub = [5, 2, 1].find((n) => (step / n) * pps >= 8) ?? 1;
    g.font = "11px " + getComputedStyle(document.body).getPropertyValue("--mono");
    const first = Math.floor(t0 / step) - 1;
    const last = Math.ceil(t1 / step) + 1;
    for (let i = first; i <= last; i++) {
      const t = i * step;
      const x = t * pps - view.left;
      g.fillStyle = tick;
      g.fillRect(Math.round(x), 24, 1, 10);
      if (x > -8 && x < w - 4) {
        g.fillStyle = text;
        g.fillText(formatRulerTime(t, step), Math.round(x) + 4, 20);
      }
      if (sub > 1 && i < last) {
        for (let n = 1; n < sub; n++) {
          const sx = (t + (step * n) / sub) * pps - view.left;
          g.fillStyle = tick;
          g.fillRect(Math.round(sx), 28, 1, 6);
        }
      }
    }
    void theme;
  }, [view.left, view.width, pps, theme]);

  const timeAt = (clientX: number, el: HTMLElement) => (clientX - el.getBoundingClientRect().left + view.left) / pps;

  return (
    <div className="ruler-canvas" style={{ width: Math.max(view.width, 1), position: "sticky", left: headerW }}
      onPointerDown={(e) => {
        const el = e.currentTarget;
        const y = e.clientY - el.getBoundingClientRect().top;
        const t = snap(timeAt(e.clientX, el), grid, project, e.altKey);
        if (y < 12) {
          const a = t;
          let b = t;
          startDrag(e, (_dx, _dy, ev) => { b = snap(timeAt(ev.clientX, el), grid, project, ev.altKey); setLoopPreview([Math.min(a, b), Math.max(a, b)]); },
            () => { setLoopPreview(null); if (Math.abs(b - a) > 0.05) act("transport.setLoop", { start: Math.min(a, b), end: Math.max(a, b), enabled: true }); });
        } else {
          act("transport.setPosition", { time: t });
          startDrag(e, (_dx, _dy, ev) => act("transport.setPosition", { time: snap(timeAt(ev.clientX, el), grid, project, ev.altKey) }));
        }
      }}>
      <canvas ref={ref} style={{ position: "absolute", left: 0, top: 0, width: view.width, height: 34 }} />
      <LoopBar project={project} pps={pps} viewLeft={view.left} grid={grid} />
      {project.markers.map((m) => (
        <div key={m.id} className="marker" style={{ left: m.time * pps - view.left }}
          onPointerDown={(e) => { e.stopPropagation(); act("transport.setPosition", { time: m.time }); }}
          onDoubleClick={() => { void askText({ title: "Marker name", hint: "Shown on the timeline.", value: m.name, ok: "Rename" }).then((name) => { if (name !== null) act("marker.set", { id: m.id, name }); }); }}
          onContextMenu={(e) => openMenu(e, [
            { label: "Rename…", icon: "file", run: () => { void askText({ title: "Marker name", hint: "Shown on the timeline.", value: m.name, ok: "Rename" }).then((name) => { if (name !== null) act("marker.set", { id: m.id, name }); }); } },
            { label: "Move to playhead", icon: "arrowRight", run: () => act("marker.set", { id: m.id, time: live.tick.t }) },
            { label: "Delete marker", icon: "trash", danger: true, run: () => act("marker.remove", { id: m.id }) },
          ])}>
          {m.name || `M${m.number}`}
        </div>
      ))}
    </div>
  );
}

let setLoopPreview: (v: [number, number] | null) => void = () => {};

function LoopBar({ project, pps, viewLeft, grid }: { project: Project; pps: number; viewLeft: number; grid: Grid }) {
  const [preview, setPreview] = useState<[number, number] | null>(null);
  setLoopPreview = setPreview;
  const [s, e] = preview ?? project.loop;
  if (e - s <= 0.01) return null;
  return (
    <div className={cx("loop-bar", project.looping && "on")} style={{ left: s * pps - viewLeft, width: (e - s) * pps }}
      title="Loop range. Drag to move, double-click to toggle, drag the empty strip to draw a new range"
      onDoubleClick={() => act("transport.setLooping", { enabled: !project.looping })}
      onPointerDown={(ev) => {
        ev.stopPropagation();
        const len = e - s;
        let ns = s;
        startDrag(ev, (dx, _dy, pe) => { ns = snap(s + dx / pps, grid, project, pe.altKey); setPreview([ns, ns + len]); },
          () => { setPreview(null); if (ns !== s) act("transport.setLoop", { start: ns, end: ns + len }); });
      }} />
  );
}

/* ------------------------------------------------------------------ clips */

interface SettledClip { id: string; start: number; end: number; offset: number; fadeIn: number; fadeOut: number }

/** The clip as the drag is showing it, so the picture and the value we save are the same. */
function shownClip(clip: Clip, preview: DragPreview | null, settled: SettledClip[] | null) {
  let start = clip.start, end = clip.end, fadeIn = clip.fadeIn ?? 0, fadeOut = clip.fadeOut ?? 0, offset = clip.offset;
  const dragging = preview != null && preview.ids.includes(clip.id);
  if (dragging && preview) {
    if (preview.mode === "move") { start += preview.dt; end += preview.dt; }
    if (preview.mode === "l") {
      if (clip.kind === "midi") start = clamp(start + preview.dt, 0, end - 0.02);
      else {
        const ns = clamp(start + preview.dt, Math.max(0, clip.start - clip.offset), end - 0.02);
        offset += ns - start;
        start = ns;
      }
    }
    if (preview.mode === "r") end = Math.max(start + 0.02, end + preview.dt);
    if (preview.mode === "fi") fadeIn = clamp(fadeIn + preview.dt, 0, end - start);
    if (preview.mode === "fo") fadeOut = clamp(fadeOut - preview.dt, 0, end - start);
    if (preview.mode === "slip") offset = Math.max(0, offset - preview.dt);
    return { start, end, fadeIn, fadeOut, offset };
  }
  const held = settled?.find((item) => item.id === clip.id);
  if (held) return held;
  return { start, end, fadeIn, fadeOut, offset };
}

const GAIN_MIN = -60;
const GAIN_MAX = 24;

/** Live clip-gain drag. The waveform reads this so it grows and shrinks before the engine answers. */
let gainDrag: { base: Map<string, number>; delta: number } | null = null;
const gainPending = new Map<string, number>();
const gainListeners = new Set<() => void>();

function emitGain() {
  gainListeners.forEach((fn) => fn());
}

function subscribeGain(fn: () => void) {
  gainListeners.add(fn);
  return () => { gainListeners.delete(fn); };
}

function roundGain(db: number) {
  return clamp(Math.round(db * 10) / 10, GAIN_MIN, GAIN_MAX);
}

const gainSnap = new Map<string, { stored: number; delta: number | null; pending: number | null; value: number }>();

function gainSnapshot(id: string, stored: number) {
  const delta = gainDrag?.base.has(id) ? gainDrag.delta : null;
  const pending = gainPending.get(id) ?? null;
  const prev = gainSnap.get(id);
  if (prev && prev.stored === stored && prev.delta === delta && prev.pending === pending) return prev.value;
  let value = stored;
  if (delta != null && gainDrag) value = roundGain(gainDrag.base.get(id)! + delta);
  else if (pending != null && Math.abs(pending - stored) >= 0.05) value = pending;
  gainSnap.set(id, { stored, delta, pending, value });
  return value;
}

function useClipGain(id: string, stored: number) {
  return useSyncExternalStore(subscribeGain, () => gainSnapshot(id, stored), () => stored);
}

function publishClipGain(force: boolean, lastSent: { t: number }) {
  if (!gainDrag) return;
  const now = performance.now();
  if (!force && (gainDrag.base.size !== 1 || now - lastSent.t < 40)) return;
  lastSent.t = now;
  const calls = [...gainDrag.base.entries()].map(([id, db]) => ({
    method: "clip.set",
    params: { id, gainDb: roundGain(db + gainDrag!.delta) },
  }));
  if (calls.length === 1) void act("clip.set", calls[0].params);
  else void act("batch.run", { label: "Clip gain", calls });
}

const ClipView = memo(function ClipView({ clip, track, pps, selected, preview, settled, view, onDown, trackIndex, timeAt, onTime }: {
  clip: Clip; track: Track; pps: number; selected: boolean; preview: DragPreview | null; settled: SettledClip[] | null; view: { left: number; width: number };
  onDown: (e: React.PointerEvent, clip: Clip, mode: DragPreview["mode"]) => void; trackIndex: number;
  timeAt: (clientX: number) => number;
  onTime: (e: React.PointerEvent) => void;
}) {
  const tool = useStore((s) => s.tool);
  const heights = useTrackHeights();
  const [liveGain, setLiveGain] = useState<[number, number][] | null>(null);
  const gainDb = useClipGain(clip.id, clip.gainDb ?? 0);
  const shown = shownClip(clip, preview, settled);
  const { start, end, fadeIn, fadeOut, offset } = shown;
  const affected = preview != null && preview.ids.includes(clip.id);
  const colour = clip.colour || track.colour;
  const left = start * pps, width = Math.max(2, (end - start) * pps);
  if (left > view.left + view.width + 400 || left + width < view.left - 400) return null;
  const moved = affected && preview?.mode === "move" && preview.trackDelta !== 0;
  const destTrack = moved ? useStore.getState().project?.tracks[trackIndex + preview.trackDelta] : undefined;
  const style: React.CSSProperties = {
    left, width,
    background: `linear-gradient(180deg, ${shade(colour, 0.55)}, ${shade(colour, 0.28)})`,
    border: `1px solid ${shade(colour, 0.9)}`,
    transform: moved ? `translateY(${preview!.dy}px)` : undefined,
    opacity: affected && preview?.copy ? 0.75 : undefined,
    ...(destTrack ? { height: Math.max(28, heightOf(heights, destTrack.id) - 8), bottom: "auto", zIndex: 5 } : {}),
  };
  const offsetDelta = offset - clip.offset;
  const gainSource = liveGain ?? clip.gainPoints;
  const drawClip = {
    ...clip, start, end, offset, fadeIn, fadeOut, gainDb,
    gainPoints: gainSource?.map(([t, db]) => [t - offsetDelta, db] as [number, number]),
  };
  const notes = clip.notes ?? [];
  const pitches = notes.map((n) => n[0]);
  const lo = Math.min(...pitches, 60) - 2, hi = Math.max(...pitches, 72) + 2;

  return (
    <div className={cx("clip", selected && "selected", clip.muted && "muted")} style={style} data-clip={clip.id} data-track-index={trackIndex}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const selectOnly = () => { selectTrack(track.id); useStore.setState({ selectedClips: [clip.id], selectedPlugin: null }); };
        if (tool === "erase") { e.stopPropagation(); selectOnly(); act("clip.delete", { id: clip.id }); return; }
        if (tool === "split") {
          e.stopPropagation();
          selectOnly();
          const t = snap(timeAt(e.clientX), useStore.getState().grid, useStore.getState().project!, e.altKey);
          splitClipAt(clip.id, t);
          return;
        }
        if (tool === "slip") { onDown(e, clip, "slip"); return; }
        if (tool === "time") { e.stopPropagation(); selectOnly(); onTime(e); return; }
        onDown(e, clip, "move");
      }}
      onDoubleClick={() => { if (tool === "move") useStore.setState({ editorClip: clip.id, bottom: "editor", selectedClips: [clip.id], selectedPlugin: null }); }}
      onContextMenu={(e) => {
        const st = useStore.getState();
        if (!st.selectedClips.includes(clip.id)) { selectTrack(track.id); useStore.setState({ selectedClips: [clip.id], selectedPlugin: null }); }
        const ids = useStore.getState().selectedClips;
        const each = (method: string, params: (id: string) => Record<string, unknown>, label: string) =>
          act("batch.run", { label, calls: ids.map((id) => ({ method, params: params(id) })) });
        const here = timeAt(e.clientX);
        openMenu(e, [
          { label: "Open in editor", icon: clip.kind === "midi" ? "piano" : "wave", keys: "E", run: () => useStore.setState({ editorClip: clip.id, bottom: "editor" }) },
          { separator: true },
          { label: "Split here", icon: "scissors", run: () => splitClipAt(clip.id, here) },
          { label: "Split at playhead", icon: "scissors", keys: "S", run: splitAtPlayhead },
          { label: "Cut", icon: "scissors", keys: "Ctrl+X", run: cutSelection },
          { label: "Copy", icon: "copy", keys: "Ctrl+C", run: copySelection },
          { label: "Paste", icon: "copy", keys: "Ctrl+V", run: () => pasteClips(here, track.id) },
          { label: "Duplicate", icon: "copy", keys: "Ctrl+D", run: () => each("clip.duplicate", (id) => ({ id }), "Duplicate") },
          ...(clip.kind === "audio" ? [
            { label: "Crossfade overlaps", icon: "layers", keys: "X", run: crossfadeSelection },
            { label: "Normalize to −1 dB", icon: "wave", run: () => each("clip.normalize", (id) => ({ id, peakDb: -1 }), "Normalize") },
            { label: clip.reversed ? "Play forwards" : "Reverse", icon: "rewind", run: () => act("clip.set", { id: clip.id, reversed: !clip.reversed }) },
          ] : []),
          ...(clip.kind === "midi" ? [{ label: "Quantize to 1/16", icon: "magnet", keys: "Q", run: () => each("midi.quantize", (id) => ({ clipId: id, grid: 0.25 }), "Quantize") }] : []),
          { label: clip.muted ? "Unmute" : "Mute", icon: "power", keys: "Shift+M", run: () => each("clip.set", (id) => ({ id, muted: !clip.muted }), "Mute clips") },
          { colours: { value: clip.colour, run: (c) => each("clip.set", (id) => ({ id, colour: c }), "Clip colour") } },
          { separator: true },
          { label: "Delete", icon: "trash", danger: true, keys: "Del", run: () => each("clip.delete", (id) => ({ id }), "Delete clips") },
        ]);
      }}>
      <div className="clip-label" style={{ background: shade(colour, 0.5) }} title="Drag to move"
        onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); onDown(e, clip, "move"); }}>{clip.name}</div>
      {clip.takes && clip.takes.count > 1 && (
        <span className="takes" title="Takes recorded in a loop. Click to cycle; open the editor to comp"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => act("clip.set", { id: clip.id, take: (clip.takes!.current + 1) % clip.takes!.count })}>
          Take {clip.takes.current + 1}/{clip.takes.count}
        </span>
      )}
      {clip.kind === "audio" && (
        <Waveform clip={drawClip} pxPerSec={pps} colour="rgba(255,255,255,.82)" viewLeft={view.left} viewWidth={view.width} clipLeft={left} mono={track.channels === 1} />
      )}
      {clip.kind === "audio" && (
        <ClipGain id={clip.id} points={clip.gainPoints} duration={end - start} offsetDelta={offsetDelta} onDraft={setLiveGain} />
      )}
      {clip.kind === "audio" && (
        <div className={cx("clip-gain", gainDrag?.base.has(clip.id) && "active")}
          title="Drag up or down to change this clip's volume. Shift drags finer. Double-click returns to 0 dB."
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            const st = useStore.getState();
            const chosen = st.selectedClips.includes(clip.id) ? st.selectedClips : [clip.id];
            if (!st.selectedClips.includes(clip.id)) {
              selectTrack(track.id);
              useStore.setState({ selectedClips: [clip.id], selectedPlugin: null });
            }
            const base = new Map<string, number>();
            for (const lane of st.project?.tracks ?? [])
              for (const item of lane.clips)
                if (item.kind === "audio" && chosen.includes(item.id)) base.set(item.id, item.gainDb ?? 0);
            if (!base.has(clip.id)) base.set(clip.id, clip.gainDb ?? 0);
            gainDrag = { base, delta: 0 };
            emitGain();
            const lastSent = { t: 0 };
            startDrag(e, (_dx, dy, ev) => {
              if (!gainDrag) return;
              gainDrag = { base, delta: -(ev.shiftKey ? dy * 0.02 : dy * 0.1) };
              emitGain();
              publishClipGain(false, lastSent);
            }, () => {
              if (!gainDrag) return;
              for (const [id, db] of base) gainPending.set(id, roundGain(db + gainDrag!.delta));
              publishClipGain(true, lastSent);
              gainDrag = null;
              emitGain();
            });
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            gainPending.set(clip.id, 0);
            emitGain();
            void act("clip.set", { id: clip.id, gainDb: 0 });
          }}>
          {formatDb(gainDb)}
        </div>
      )}
      {clip.kind === "midi" && (
        <svg style={{ position: "absolute", left: 0, top: 17, width, height: "calc(100% - 17px)" }} preserveAspectRatio="none" viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, hi - lo)}`}>
          {notes.map((n, i) => {
            const heldNow = settled?.find((item) => item.id === clip.id);
            const holdingMove = !affected && !!heldNow && Math.abs((heldNow.end - heldNow.start) - (clip.end - clip.start)) < 0.0005 && Math.abs(heldNow.start - clip.start) > 0.0005;
            const noteOrigin = (affected && preview?.mode === "move") || holdingMove ? clip.start : start;
            const x = (n[1] - noteOrigin) * pps;
            const w = Math.max(1, n[2] * pps);
            if (x + w <= 0 || x >= width) return null;
            return <rect key={i} x={x} y={hi - n[0] - 1} width={w} height={0.8} fill="rgba(255,255,255,.85)" />;
          })}
        </svg>
      )}
      {clip.kind === "audio" && (
        <svg className="fades" preserveAspectRatio="none" viewBox="0 0 100 100">
          {fadeIn > 0 && <path d={`M0,0 L0,100 Q${(fadeIn / (end - start)) * 50},10 ${(fadeIn / (end - start)) * 100},0 Z`} fill="rgba(0,0,0,.35)" />}
          {fadeOut > 0 && <path d={`M100,0 L100,100 Q${100 - (fadeOut / (end - start)) * 50},10 ${100 - (fadeOut / (end - start)) * 100},0 Z`} fill="rgba(0,0,0,.35)" />}
        </svg>
      )}
      {tool === "move" && <>
        <div className="edge l" onPointerDown={(e) => { e.stopPropagation(); onDown(e, clip, "l"); }} />
        <div className="edge r" onPointerDown={(e) => { e.stopPropagation(); onDown(e, clip, "r"); }} />
        {clip.kind === "audio" && <>
          <div className="fade-h" title="Fade in" style={{ left: Math.max(6, fadeIn * pps) }} onPointerDown={(e) => { e.stopPropagation(); onDown(e, clip, "fi"); }} />
          <div className="fade-h" title="Fade out" style={{ left: Math.min(width - 6, width - fadeOut * pps) }} onPointerDown={(e) => { e.stopPropagation(); onDown(e, clip, "fo"); }} />
        </>}
      </>}
    </div>
  );
});

/* ------------------------------------------------------------------ live-session presence */

function PeerCursors({ pps, scrollLeft }: { pps: number; scrollLeft: number }) {
  const headerW = useHeaderWidth((s) => s.w);
  const presence = useCollab((s) => s.presence);
  const peers = useCollab((s) => s.peers);
  return (
    <>
      {peers.map((p) => {
        const at = presence[p.id]?.hover;
        if (at == null || at * pps < scrollLeft - 1) return null;
        return (
          <div key={p.id} className="peer-cursor" style={{ transform: `translateX(${headerW + at * pps}px)`, color: p.colour }}>
            <span style={{ background: p.colour }}>{p.name}</span>
          </div>
        );
      })}
    </>
  );
}

function PeerDots({ trackId }: { trackId: string }) {
  const presence = useCollab((s) => s.presence);
  const peers = useCollab((s) => s.peers);
  const here = peers.filter((p) => presence[p.id]?.track === trackId);
  if (!here.length) return null;
  return (
    <span className="peer-dots">
      {here.map((p) => <span key={p.id} title={`${p.name} is on this track`} style={{ background: p.colour }}>{p.name.slice(0, 1).toUpperCase()}</span>)}
    </span>
  );
}

/* ------------------------------------------------------------------ track header */

function TrackMeter({ id }: { id: string }) {
  const ref = useMeterCanvas(id, false);
  return <canvas ref={ref} className="track-meter" title="Level of this track" />;
}

/** The line under a track: drag to resize that track, Shift+drag to resize every track, double-click to reset. */
function TrackDivider({ id, height }: { id: string; height: number }) {
  const [active, setActive] = useState(false);
  return (
    <div className={cx("track-resize", active && "active")} title="Drag to resize this track · Shift+drag resizes all · double-click resets"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        setActive(true);
        startDrag(e, (_dx, dy, ev) => (ev.shiftKey ? setAllTrackHeights : (h: number) => setTrackHeight(id, h))(height + dy), () => setActive(false));
      }}
      onDoubleClick={() => resetTrackHeight(id)} />
  );
}

function TrackHeader({ track, selected, height, depth }: { track: Track; selected: boolean; height: number; depth: number }) {
  const [name, setName] = useState(track.name);
  useEffect(() => setName(track.name), [track.name]);
  const autoOpen = useStore((s) => !!s.automationOpen[track.id]);
  const recordable = track.kind === "audio" || track.kind === "instrument";
  const [vol, setVol] = useState<number | null>(null);
  const db = vol ?? track.volumeDb ?? 0;

  const tight = height < 88;
  const compact = height < 148;
  const menuButton = (
    <button className="toggle" title="Track menu" onClick={(e) => { e.stopPropagation(); openTrackMenu(e, track); }}>⋯</button>
  );
  const controls = (
    <>
      <button className={cx("toggle mute", track.mute && "on")} title="Mute" onClick={() => act("track.set", { id: track.id, mute: !track.mute })}>M</button>
      <button className={cx("toggle solo", track.solo && "on")} title="Solo" onClick={() => act("track.set", { id: track.id, solo: !track.solo })}>S</button>
      {recordable && <button className={cx("toggle arm", track.armed && "on")} title="Arm for recording" onClick={() => act("track.arm", { id: track.id, armed: !track.armed })}>●</button>}
      {recordable && (
        <button className={cx("toggle mon", track.monitor === "on" && "on", track.live && "live")}
          title={`Input monitoring for this track: ${track.monitor === "on" ? "On (always hear the input)" : track.monitor === "off" ? "Off (never hear the input)" : "Auto (hear the input only while recording)"}${
            track.live ? ". Live now: the input is going through this track's effects." : ""} Click to cycle Auto → On → Off.`}
          onClick={() => act("track.setMonitor", { id: track.id, mode: track.monitor === "auto" ? "on" : track.monitor === "on" ? "off" : "auto" })}>
          {track.monitor === "off" ? "–" : track.monitor === "on" ? "I" : "A"}
        </button>
      )}
      <button className={cx("toggle", autoOpen && "on")} title="Automation lane (A)" onClick={() => toggleAutomation(track)}><Icon name="automation" size={12} /></button>
    </>
  );

  return (
    <div className={cx("track-head", compact && "compact", tight && "tight")} style={{ height }} title="Click to select this track. Ctrl+click adds or removes it."
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (e.clientX > e.currentTarget.getBoundingClientRect().right - 10) return;
        if ((e.target as HTMLElement).closest("button, select, .slot, .slider")) return;
        if (e.ctrlKey || e.metaKey) { selectTrack(track.id, "toggle"); return; }
        selectTrack(track.id);
        const row = e.currentTarget.closest(".track-row");
        if (!(row instanceof HTMLElement)) return;
        beginTrackReorder(e, { id: track.id, name: track.name, colour: track.colour, axis: "y", source: row });
      }}
      onContextMenu={(e) => openTrackMenu(e, track)}>
      <div className="colour" style={{ background: track.colour, boxShadow: `0 0 12px ${shade(track.colour, 0.6)}` }} />
      <div className="track-head-scroll" style={{ paddingLeft: 12 + depth * 12 }}>
      <div className="row name-line" style={{ gap: tight ? 4 : 6, paddingRight: 6 }}>
        <input className="name" data-name={track.id} value={name} onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== track.name && act("track.set", { id: track.id, name: name.trim() })}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setName(track.name); (e.target as HTMLInputElement).blur(); } }} />
        <PeerDots trackId={track.id} />
        {(track.kind === "audio" || track.kind === "group") && (
          <button className="kind" title="Choose stereo or mono" onClick={(e) => openFormatMenu(e, track)}>
            {track.channels === 1 ? (tight ? "M" : "MONO") : (tight ? "ST" : "STEREO")}
          </button>
        )}
        {!tight && track.kind === "return" && <span className="kind">FX</span>}
        {!tight && track.kind === "instrument" && <span className="kind">INST</span>}
        {!tight && track.kind === "group" && <span className="kind">BUS</span>}
        <div className="grow" />
        {menuButton}
        {tight && controls}
      </div>
      {track.kind !== "group" && <TrackIo track={track} />}
      {!tight && <div className="row" style={{ gap: 4 }}>{controls}</div>}
      <div className="track-fx">
        <FxToggle trackId={track.id} plugins={track.plugins} />
        <div className="track-fx-list">
          {track.plugins.map((p, i) => p.synth ? <SynthSlot key={p.id} p={p} trackId={track.id} compact /> : <InsertSlot key={p.id} p={p} index={i} compact />)}
          {!track.plugins.length && <span className="faint small ellipsis">No effects</span>}
        </div>
        <button className="toggle" title="Add an effect" onClick={() => useStore.setState({ picker: { trackId: track.id } })}><Icon name="plus" size={11} /></button>
      </div>
      <div className="row" style={{ gap: 6, paddingRight: 10 }} title={`Volume ${formatDb(db)} dB. Double-click for 0 dB`}>
        <input type="range" className="slider grow" min={0} max={1} step={0.001} value={dbToFader(db)}
          onChange={(e) => { const v = faderToDb(+e.target.value); setVol(v); act("track.set", { id: track.id, volumeDb: v }); }}
          onPointerUp={() => setVol(null)}
          onDoubleClick={() => act("track.set", { id: track.id, volumeDb: 0 })} />
        {!tight && <DbField className="mono small dim" style={{ width: 46, textAlign: "right" }} db={db} min={-100} max={15} onChange={(v) => { setVol(null); act("track.set", { id: track.id, volumeDb: v }); }} />}
      </div>
      <TrackMeter id={track.id} />
      </div>
      {selected && <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 2, background: "var(--violet)" }} />}
    </div>
  );
}

function choiceMenu(choices: Choice[], current: string, pick: (v: string) => void, footer: MenuItem[]): MenuItem[] {
  const items: MenuItem[] = [];
  let group: string | undefined;
  for (const c of choices) {
    if (c.group !== group && items.length) items.push({ separator: true });
    group = c.group;
    items.push({ label: c.label, icon: c.value === current ? "check" : undefined, run: () => pick(c.value) });
  }
  return [...items, { separator: true }, ...footer];
}

/** Input (mic / keyboard) and output (speakers / bus) pickers right under the track name. */
function TrackIo({ track }: { track: Track }) {
  const project = useStore((s) => s.project)!;
  const devices = useStore((s) => s.devices);
  const recordable = track.kind === "audio" || track.kind === "instrument";
  const settings: MenuItem = { label: "Audio & MIDI settings…", icon: "settings", run: () => useStore.setState({ settingsOpen: "audio" }) };
  const open = async (e: ReactMouseEvent<HTMLButtonElement>, kind: "in" | "out") => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const at = { clientX: r.left, clientY: r.bottom + 4, preventDefault() {}, stopPropagation() {} };
    const d = devices ?? await loadDevices().catch(() => null);
    openMenu(at, kind === "in"
      ? choiceMenu(inputChoices(track, d), track.input ?? "", (v) => act("track.setInput", { id: track.id, input: v }), [settings])
      : choiceMenu(outputChoices(track, project, d), track.output ?? "master", (v) => act("track.set", { id: track.id, output: v }), [settings]));
  };
  return (
    <div className="io-row">
      {recordable && (
        <button className={cx("io-chip", !track.input && "off")} title={`Input: ${inputLabel(track)}. Click to choose the ${track.kind === "instrument" ? "keyboard / MIDI device" : "microphone or input"}`}
          onClick={(e) => open(e, "in")}>
          <Icon name={track.kind === "instrument" ? "keyboard" : "mic"} size={11} /><span className="ellipsis">{inputLabel(track)}</span>
        </button>
      )}
      <button className={cx("io-chip", track.output === "none" && "off")} title={`Output: ${outputLabel(track, project)}. Click to route to the master, a group or a hardware output`}
        onClick={(e) => open(e, "out")}>
        <Icon name="speaker" size={11} /><span className="ellipsis">{outputLabel(track, project)}</span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ automation lane */

function AutomationRow({ track, laneKey, pps, width, project }: { track: Track; laneKey: string; pps: number; width: number; project: Project }) {
  const [pluginId, paramId] = laneKey.split(":");
  const lane: AutomationLane | undefined = track.automation.find((l) => l.pluginId === pluginId && l.paramId === paramId);
  const [drag, setDrag] = useState<{ index: number; t: number; v: number } | null>(null);
  const min = lane?.min ?? 0, max = lane?.max ?? 1;
  const norm = (v: number) => (max > min ? (v - min) / (max - min) : 0);
  const h = AUTO_H - 8;

  const choices = [
    { key: `${track.volumePluginId}:volume`, label: "Volume" },
    { key: `${track.volumePluginId}:pan`, label: "Pan" },
    ...track.plugins.flatMap((p) => p.params.slice(0, 24).map((q) => ({ key: `${p.id}:${q.id}`, label: `${p.name} · ${q.name}` }))),
  ];
  for (const l of track.automation) if (!choices.some((c) => c.key === `${l.pluginId}:${l.paramId}`)) choices.push({ key: `${l.pluginId}:${l.paramId}`, label: l.name });

  const points = (lane?.points ?? []).map((p, i) => (drag && drag.index === i ? [drag.t, drag.v, p[2]] : p)) as [number, number, number][];
  const path = points.length
    ? `M0,${(1 - norm(points[0][1])) * h + 4} ` + points.map((p) => `L${p[0] * pps},${(1 - norm(p[1])) * h + 4}`).join(" ") + ` L${width},${(1 - norm(points[points.length - 1][1])) * h + 4}`
    : "";

  const timeNorm = (e: { clientX: number; clientY: number }, el: Element) => {
    const r = el.getBoundingClientRect();
    return { t: Math.max(0, (e.clientX - r.left) / pps), n: clamp(1 - (e.clientY - r.top - 4) / h, 0, 1) };
  };

  return (
    <div className="auto-row" style={{ height: AUTO_H }}>
      <div className="auto-head">
        <select className="input sm" value={laneKey} onChange={(e) => useStore.setState((s) => ({ automationOpen: { ...s.automationOpen, [track.id]: e.target.value } }))}>
          {choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <div className="row" style={{ gap: 4 }}>
          <select className="input sm grow" value={track.automationMode} title="Automation mode. Touch and latch record fader moves during playback"
            onChange={(e) => act("track.set", { id: track.id, automationMode: e.target.value })}>
            <option value="read">Read</option><option value="touch">Touch</option><option value="latch">Latch</option><option value="write">Write</option>
          </select>
          <button className="btn sm ghost" title="Clear lane" onClick={() => act("automation.clear", { pluginId, paramId })}><Icon name="trash" size={12} /></button>
        </div>
      </div>
      <div className="lane" style={{ width, height: AUTO_H }}
        onPointerDown={(e) => {
          if (e.button !== 0 || e.target !== e.currentTarget && (e.target as Element).tagName !== "svg" && (e.target as Element).tagName !== "path") return;
          const { t, n } = timeNorm(e, e.currentTarget);
          act("automation.addPoint", { pluginId, paramId, time: snap(t, useStore.getState().grid, project, e.altKey), norm: n });
        }}>
        <svg width={width} height={AUTO_H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {path && <path d={path} stroke="var(--cyan)" strokeWidth={1.6} fill="none" />}
          {path && <path d={`${path} L${width},${AUTO_H} L0,${AUTO_H} Z`} fill="rgba(0,209,255,.07)" />}
          {points.map((p, i) => (
            <circle key={i} cx={p[0] * pps} cy={(1 - norm(p[1])) * h + 4} r={4.5} fill="#07080c" stroke="var(--cyan)" strokeWidth={2} style={{ cursor: "move" }}
              onDoubleClick={(e) => { e.stopPropagation(); act("automation.removePoint", { pluginId, paramId, index: i }); }}
              onContextMenu={(e) => openMenu(e, [{ label: "Delete point", icon: "trash", danger: true, run: () => act("automation.removePoint", { pluginId, paramId, index: i }) }])}
              onPointerDown={(e) => {
                e.stopPropagation();
                const svg = (e.currentTarget as SVGElement).ownerSVGElement!;
                let last = { t: p[0], n: norm(p[1]) };
                startDrag(e, (_dx, _dy, ev) => {
                  last = timeNorm(ev, svg);
                  last.t = snap(last.t, useStore.getState().grid, project, ev.altKey);
                  setDrag({ index: i, t: last.t, v: min + last.n * (max - min) });
                }, () => {
                  setDrag(null);
                  act("automation.movePoint", { pluginId, paramId, index: i, time: last.t, norm: last.n });
                });
              }}>
              <title>{lane?.name}: {p[1].toFixed(3)} at {p[0].toFixed(2)} s. Drag to move, double-click to delete</title>
            </circle>
          ))}
        </svg>
        {!points.length && <span className="small faint" style={{ position: "absolute", left: 10, top: 28, pointerEvents: "none" }}>Click to add points · drag to shape · double-click a point to delete</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ master row */

/** The mix output. It sits on the track list and does not accept clips. */
function MasterRow({ laneW }: { laneW: number }) {
  const project = useStore((s) => s.project)!;
  const devices = useStore((s) => s.devices);
  const [vol, setVol] = useState<number | null>(null);
  const db = vol ?? project.master.volumeDb ?? 0;
  const h = TRACK_H_DEFAULT;
  const outs = devices?.outputs ?? [];
  const masterOut = devices?.masterOutput ?? outs[0] ?? "Stereo out";

  useEffect(() => { loadDevices().catch(() => {}); }, []);

  const refuseClip = (e: ReactDragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "none";
  };

  return (
    <div className="track-row master-row" style={{ height: h, width: "100%" }}
      title="Master. The mix leaves through here. Clips can't be placed on it."
      onDragOver={refuseClip}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(e, [{ label: "Add an effect", icon: "plus", run: () => useStore.setState({ picker: { trackId: "master" } }) }]);
      }}>
      <div className="track-head compact" style={{ height: h }}>
        <div className="colour" style={{ background: "linear-gradient(180deg, #7c5cff, #00d1ff)" }} />
        <div className="track-head-scroll">
          <div className="row name-line" style={{ gap: 6, paddingRight: 6 }}>
            <span className="name">Master</span>
            <span className="kind">MASTER</span>
          </div>
          <div className="io-row">
            {outs.length > 1 ? (
              <button className="io-chip" title="Speakers the master plays through"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  openMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault() {}, stopPropagation() {} },
                    outs.map((o) => ({ label: o, icon: o === masterOut ? "check" : undefined, run: () => { void act("devices.setMasterOutput", { name: o }).then(() => loadDevices()); } })));
                }}>
                <Icon name="speaker" size={11} /><span className="ellipsis">{masterOut}</span>
              </button>
            ) : (
              <span className="io-chip" title="Speakers the master plays through"><Icon name="speaker" size={11} /><span className="ellipsis">{masterOut}</span></span>
            )}
          </div>
          <div className="track-fx">
            <FxToggle trackId="master" plugins={project.master.plugins} />
            <div className="track-fx-list">
              {project.master.plugins.map((p, i) => <InsertSlot key={p.id} p={p} index={i} compact />)}
              {!project.master.plugins.length && <span className="faint small ellipsis">No effects</span>}
            </div>
            <button className="toggle" title="Add an effect on the master" onClick={() => useStore.setState({ picker: { trackId: "master" } })}><Icon name="plus" size={11} /></button>
          </div>
          <div className="row" style={{ gap: 6, paddingRight: 10 }} title={`Master volume ${formatDb(db)} dB. Double-click for 0 dB`}>
            <input type="range" className="slider grow" min={0} max={1} step={0.001} value={dbToFader(db)}
              onChange={(e) => { const v = faderToDb(+e.target.value); setVol(v); act("master.set", { volumeDb: v }); }}
              onPointerUp={() => setVol(null)}
              onDoubleClick={() => act("master.set", { volumeDb: 0 })} />
            <DbField className="mono small dim" style={{ width: 46, textAlign: "right" }} db={db} min={-100} max={15} onChange={(v) => { setVol(null); act("master.set", { volumeDb: v }); }} />
          </div>
          <TrackMeter id="master" />
        </div>
      </div>
      <div className="lane master-lane" style={{ flex: "1 0 auto", width: laneW, minWidth: laneW, height: h }} />
    </div>
  );
}

/* ------------------------------------------------------------------ main view */

export function Arrange() {
  const project = useStore((s) => s.project)!;
  const pps = useStore((s) => s.pxPerSec);
  const arrangeTool = useStore((s) => s.tool);
  const grid = useStore((s) => s.grid);
  const selectedTrack = useStore((s) => s.selectedTrack);
  const selectedTracks = useStore((s) => s.selectedTracks);
  const selectedClips = useStore((s) => s.selectedClips);
  const automationOpen = useStore((s) => s.automationOpen);
  const recording = useStore((s) => s.transport.recording);
  const body = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 1200 });
  const [preview, setPreview] = useState<DragPreview | null>(null);
  // Kept after the mouse is released so the clip does not flash its old length while the edit is saved.
  const [settled, setSettled] = useState<SettledClip[] | null>(null);
  useEffect(() => {
    if (!settled) return;
    const clips = project.tracks.flatMap((t) => t.clips);
    const matched = settled.every((held) => {
      const c = clips.find((item) => item.id === held.id);
      return !!c && Math.abs(c.start - held.start) < 0.0005 && Math.abs(c.end - held.end) < 0.0005
        && Math.abs(c.offset - held.offset) < 0.0005
        && Math.abs((c.fadeIn ?? 0) - held.fadeIn) < 0.0005 && Math.abs((c.fadeOut ?? 0) - held.fadeOut) < 0.0005;
    });
    if (matched) { setSettled(null); return; }
    const timer = window.setTimeout(() => setSettled(null), 400);
    return () => window.clearTimeout(timer);
  }, [project, settled]);
  const [rubber, setRubber] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [timeDrag, setTimeDrag] = useState<{ a: number; b: number } | null>(null);
  const [ghost, setGhost] = useState<number | null>(null);
  const [dropLane, setDropLane] = useState<string | null>(null);
  const [fileDrag, setFileDrag] = useState(false);
  const heights = useTrackHeights();
  const headerW = useHeaderWidth((s) => s.w);
  const headerRef = useRef(headerW);
  headerRef.current = headerW;
  const [headerDrag, setHeaderDrag] = useState(false);
  useEffect(() => { if (!useStore.getState().devices) loadDevices().catch(() => {}); }, []);
  const [follow, setFollow] = useState(true);

  const selected = useMemo(() => new Set(selectedClips), [selectedClips]);
  const tracks = project.tracks;
  const depthOf = useCallback((t: Track) => { let d = 0, p = t.parent; while (p && d < 6) { d++; p = tracks.find((x) => x.id === p)?.parent ?? null; } return d; }, [tracks]);

  // Always paint at least one extra screen past the playhead, the last clip, and wherever
  // the view is scrolled. A short session used to end early, and zooming in turned that
  // gap into a blank page on the right.
  const viewport = Math.max(view.width, 1);
  let far = Math.max(project.length, live.tick.t, 0);
  for (const t of tracks) for (const c of t.clips) far = Math.max(far, c.end);
  const sparePx = Math.max(viewport * 1.25, 480);
  const totalSec = far + secondsPerBar(project) * 8;
  const laneW = Math.ceil(Math.max(totalSec * pps, view.left + viewport + sparePx));

  const updateView = useCallback(() => {
    const el = body.current;
    if (el) setView({ left: el.scrollLeft, width: Math.max(200, el.clientWidth - headerRef.current) });
  }, []);

  useLayoutEffect(() => {
    updateView();
    const ro = new ResizeObserver(updateView);
    if (body.current) ro.observe(body.current);
    return () => ro.disconnect();
  }, [updateView]);

  useLayoutEffect(() => { updateView(); }, [headerW, pps, updateView]);

  useEffect(() => {
    const draw = () => {
      const t = live.tick;
      const el = body.current;
      if (playhead.current) {
        playhead.current.style.transform = `translateX(${headerRef.current + t.t * pps}px)`;
        // Scrolled behind the sticky track-name column: hide it rather than draw it over the names.
        playhead.current.style.visibility = el && t.t * pps < el.scrollLeft - 1 ? "hidden" : "";
      }
      if (el && follow && t.playing) {
        const x = t.t * pps;
        if (x > el.scrollLeft + el.clientWidth - headerRef.current - 60 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
      }
    };
    draw();
    const el = body.current;
    el?.addEventListener("scroll", draw, { passive: true });
    const off = onTick(draw) as () => void;
    return () => { el?.removeEventListener("scroll", draw); off(); };
  }, [pps, follow, headerW]);

  // Ctrl+wheel over the track info column resizes every track; over the clips it zooms around the mouse.
  // Alt+wheel anywhere also resizes every track.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      const overHeaders = e.clientX - el.getBoundingClientRect().left < headerRef.current;
      if ((e.ctrlKey && overHeaders) || e.altKey) {
        e.preventDefault();
        const y = e.clientY;
        const row = [...document.querySelectorAll<HTMLElement>(".arrange [data-track]")].find((l) => {
          const b = l.getBoundingClientRect();
          return y >= b.top && y < b.bottom;
        });
        const into = row ? y - row.getBoundingClientRect().top : 0;
        const id = row?.dataset.track;
        const scrollTop = el.scrollTop;
        resizeAllTracks(e.deltaY < 0 ? 10 : -10);
        requestAnimationFrame(() => {
          const again = id ? document.querySelector<HTMLElement>(`.arrange [data-track="${CSS.escape(id)}"]`) : null;
          if (again) el.scrollTop = scrollTop + (again.getBoundingClientRect().top - (y - into));
          else el.scrollTop = scrollTop;
        });
      } else if (e.ctrlKey) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const mx = e.clientX - r.left - headerRef.current;
        const scrollTop = el.scrollTop;
        const tAtMouse = (el.scrollLeft + mx) / useStore.getState().pxPerSec;
        const next = clamp(useStore.getState().pxPerSec * (e.deltaY < 0 ? 1.18 : 1 / 1.18), 4, 1200);
        useStore.setState({ pxPerSec: next });
        const apply = () => { el.scrollLeft = Math.max(0, tAtMouse * next - mx); el.scrollTop = scrollTop; updateView(); };
        apply();
        requestAnimationFrame(apply);
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [updateView]);

  const timeAtClient = (clientX: number) => {
    const r = body.current!.getBoundingClientRect();
    return Math.max(0, (clientX - r.left - headerRef.current + body.current!.scrollLeft) / pps);
  };

  const onClipDown = useCallback((e: React.PointerEvent, clip: Clip, mode: DragPreview["mode"]) => {
    const st = useStore.getState();
    let ids = st.selectedClips;
    if (mode === "move" && clip.kind === "audio" && e.ctrlKey && e.altKey) {
      mode = "slip";
      ids = [clip.id];
    } else if (e.shiftKey || e.ctrlKey) {
      ids = ids.includes(clip.id) ? (e.ctrlKey && !e.shiftKey ? ids : ids.filter((x) => x !== clip.id)) : [...ids, clip.id];
      if (!ids.includes(clip.id) && mode === "move") { useStore.setState({ selectedClips: ids }); return; }
    } else if (!ids.includes(clip.id)) ids = [clip.id];
    const owner = st.project!.tracks.find((t) => t.clips.some((c) => c.id === clip.id));
    if (owner && (e.ctrlKey || e.metaKey)) {
      const cur = useStore.getState();
      const tracks = cur.selectedTracks.length ? cur.selectedTracks : cur.selectedTrack ? [cur.selectedTrack] : [];
      if (!tracks.includes(owner.id)) selectTrack(owner.id, "toggle");
    } else if (owner) selectTrack(owner.id);
    useStore.setState({ selectedClips: ids, selectedPlugin: null, editorClip: st.bottom === "editor" ? clip.id : st.editorClip });
    const moveIds = mode === "move" ? ids : [clip.id];
    const trackIndex = st.project!.tracks.findIndex((t) => t.id === owner?.id);
    let moved = false;
    let last: DragPreview = { ids: moveIds, mode, dt: 0, trackDelta: 0, dy: 0, copy: false };
    const sourceLane = document.querySelector<HTMLElement>(`.arrange [data-lane-index="${trackIndex}"]`);

    startDrag(e, (dx, _dy, ev) => {
      if (!moved && Math.abs(dx) < 3 && Math.abs(_dy) < 3) return;
      moved = true;
      const p = st.project!;
      let dt = dx / pps;
      if (mode === "move" || mode === "l" || mode === "r") {
        const edge = mode === "r" ? clip.end : clip.start;
        dt = snap(edge + dt, useStore.getState().grid, p, ev.altKey) - edge;
        if (mode === "move") dt = Math.max(dt, -Math.min(...moveIds.map((id) => p.tracks.flatMap((t) => t.clips).find((c) => c.id === id)?.start ?? 0)));
      }
      let trackDelta = 0, dy = 0;
      if (mode === "move" && sourceLane) {
        // Hit-test by height: the dragged clip sits under the pointer but still belongs to its source lane.
        const lane = [...document.querySelectorAll<HTMLElement>(".arrange [data-lane-index]")].find((l) => {
          const r = l.getBoundingClientRect();
          return ev.clientY >= r.top && ev.clientY < r.bottom;
        });
        const fits = lane && (clip.kind === "midi" ? lane.dataset.kind === "instrument" : lane.dataset.kind === "audio");
        if (lane && fits && lane !== sourceLane) {
          trackDelta = Number(lane.dataset.laneIndex) - trackIndex;
          dy = lane.getBoundingClientRect().top - sourceLane.getBoundingClientRect().top;
          if (Math.abs(dx) < 8) dt = 0;
        }
      }
      last = { ids: moveIds, mode, dt, trackDelta, dy, copy: mode === "move" && ev.ctrlKey };
      setPreview(last);
    }, () => {
      if (!moved) { setPreview(null); return; }
      const p = useStore.getState().project!;
      const all = p.tracks.flatMap((t) => t.clips.map((c) => ({ c, t })));
      const calls: { method: string; params: Record<string, unknown> }[] = [];
      const held: SettledClip[] = [];
      for (const id of last.ids) {
        const hit = all.find((x) => x.c.id === id);
        if (!hit) continue;
        const { c } = hit;
        const edge = shownClip(c, last, null);
        held.push({ id, start: edge.start, end: edge.end, offset: edge.offset, fadeIn: edge.fadeIn, fadeOut: edge.fadeOut });
        if (last.mode === "move") {
          const ti = p.tracks.findIndex((t) => t.id === hit.t.id) + last.trackDelta;
          const target = p.tracks[clamp(ti, 0, p.tracks.length - 1)];
          const compatible = (target.kind === "instrument") === (c.kind === "midi") || target.kind === "audio" && c.kind === "audio";
          const trackId = last.trackDelta !== 0 && compatible ? target.id : undefined;
          if (last.copy) calls.push({ method: "clip.duplicate", params: { id, start: edge.start } });
          else calls.push({ method: "clip.move", params: { id, start: edge.start, ...(trackId ? { trackId } : {}) } });
        } else if (last.mode === "l") calls.push({ method: "clip.trim", params: { id, start: edge.start } });
        else if (last.mode === "r") calls.push({ method: "clip.trim", params: { id, end: edge.end } });
        else if (last.mode === "fi") calls.push({ method: "clip.set", params: { id, fadeIn: edge.fadeIn } });
        else if (last.mode === "fo") calls.push({ method: "clip.set", params: { id, fadeOut: edge.fadeOut } });
        else if (last.mode === "slip") calls.push({ method: "clip.slip", params: { id, offset: edge.offset } });
      }
      setPreview(null);
      if (!last.copy) setSettled(held);
      const label = { move: last.copy ? "Copy clips" : "Move clips", fi: "Fade", fo: "Fade", slip: "Slip", l: "Trim", r: "Trim" }[last.mode];
      if (calls.length) void act("batch.run", { label, calls });
      else setSettled(null);
    });
  }, [pps]);

  const beginTime = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const at = (ev: { clientX: number; altKey: boolean }) => snap(timeAtClient(ev.clientX), useStore.getState().grid, project, ev.altKey);
    const anchor = at(e);
    let end = anchor;
    let dragged = false;
    startDrag(e, (dx, _dy, ev) => {
      if (Math.abs(dx) > 3) dragged = true;
      end = at(ev);
      setTimeDrag({ a: Math.min(anchor, end), b: Math.max(anchor, end) });
    }, () => {
      setTimeDrag(null);
      if (!dragged) act("transport.setPosition", { time: anchor });
      else if (Math.abs(end - anchor) > 0.02) act("transport.setLoop", { start: Math.min(anchor, end), end: Math.max(anchor, end), enabled: true });
    });
  };

  const onLaneDown = (e: React.PointerEvent, track: Track) => {
    if (e.button !== 0) return;
    const toolNow = useStore.getState().tool;
    if (toolNow === "time") { beginTime(e); return; }
    if (toolNow === "split") {
      const t = snap(timeAtClient(e.clientX), useStore.getState().grid, project, e.altKey);
      const clipEl = (e.target as HTMLElement).closest<HTMLElement>("[data-clip]");
      if (clipEl?.dataset.clip) {
        if (e.ctrlKey || e.metaKey) selectTrack(track.id, "toggle");
        else selectTrack(track.id);
        useStore.setState({ selectedClips: [clipEl.dataset.clip], selectedPlugin: null });
        splitClipAt(clipEl.dataset.clip, t);
      } else {
        selectTrack(track.id, e.ctrlKey || e.metaKey ? "toggle" : "replace");
        act("transport.setPosition", { time: t });
      }
      return;
    }
    if (e.target !== e.currentTarget) return;
    const host = e.currentTarget.closest(".arrange-inner") as HTMLElement;
    const origin = () => host.getBoundingClientRect();
    const start = origin();
    const x0 = e.clientX - start.left, y0 = e.clientY - start.top;
    let dragged = false;
    const extendTracks = (e.ctrlKey || e.metaKey) && !e.shiftKey;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = additive ? useStore.getState().selectedClips : [];
    if (!extendTracks) selectTrack(track.id);
    startDrag(e, (dx, dy, ev) => {
      if (!dragged && Math.abs(dx) + Math.abs(dy) < 4) return;
      dragged = true;
      const box = origin();
      const x1 = ev.clientX - box.left, y1 = ev.clientY - box.top;
      const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      setRubber(r);
      const sel = new Set(base);
      document.querySelectorAll<HTMLElement>(".arrange [data-clip]").forEach((el) => {
        const b = el.getBoundingClientRect();
        const bx = b.left - box.left, by = b.top - box.top;
        if (bx < r.x + r.w && bx + b.width > r.x && by < r.y + r.h && by + b.height > r.y) sel.add(el.dataset.clip!);
      });
      useStore.setState({ selectedClips: [...sel] });
    }, (ev) => {
      setRubber(null);
      if (!dragged) {
        if (extendTracks) selectTrack(track.id, "toggle");
        else if (!additive) useStore.setState({ selectedClips: [] });
        act("transport.setPosition", { time: snap(timeAtClient(ev.clientX), useStore.getState().grid, project, ev.altKey) });
      }
    });
  };

  const onDrop = async (e: React.DragEvent, track?: Track) => {
    e.preventDefault();
    setDropLane(null);
    setFileDrag(false);
    const t = snap(timeAtClient(e.clientX), grid, project, e.altKey);
    const plugin = e.dataTransfer.getData("application/x-s3-plugin");
    const copiedFx = e.dataTransfer.getData(FX_COPY);
    const media = e.dataTransfer.getData("application/x-s3-media");
    const chain = e.dataTransfer.getData("application/x-s3-chain");
    if (copiedFx) {
      const { ids } = JSON.parse(copiedFx) as { ids: string[] };
      let target = track?.id;
      if (!target) {
        const created = await act("track.add", { kind: "audio" });
        target = created?.[0];
      }
      if (target && ids?.length) {
        selectTrack(target);
        useStore.setState({ bottom: "effects" });
        for (const id of ids) await act("plugin.duplicate", { id, trackId: target });
        toast(ids.length > 1 ? `${ids.length} effects added` : "Effect added", "success");
      }
      return;
    }
    if (plugin) {
      const { id, synth, name } = JSON.parse(plugin);
      let target = track?.id;
      if (!target || (synth && track?.kind !== "instrument")) {
        const ids = await act("track.add", { kind: synth ? "instrument" : "audio", name: synth ? name : undefined });
        target = ids?.[0];
      }
      if (target) {
        selectTrack(target);
        useStore.setState({ bottom: "effects" });
        const added = await act("plugin.add", { trackId: target, plugin: id }) as { id?: string } | undefined;
        if (synth && added?.id) openPlugin(added.id);
        toast(`${name} added`, "success");
      }
      return;
    }
    if (chain && track) return act("chain.load", { trackId: track.id, name: chain });
    if (media) {
      let target = track?.kind === "audio" ? track.id : undefined;
      if (!target) target = (await act("track.add", { kind: "audio" }))?.[0];
      if (target) act("clip.importAudio", { trackId: target, file: media, start: t });
      return;
    }
    if (e.dataTransfer.files.length) uploadAndImport([...e.dataTransfer.files], track?.kind === "audio" ? track.id : undefined, t);
  };

  const dragOver = (e: React.DragEvent, id: string) => {
    const types = e.dataTransfer.types;
    if (types.includes("Files") || types.includes("application/x-s3-plugin") || types.includes(FX_COPY) || types.includes("application/x-s3-media") || types.includes("application/x-s3-chain")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (dropLane !== id) setDropLane(id);
      if (types.includes("Files") && !fileDrag) setFileDrag(true);
    }
  };

  const barPx = secondsPerBar(project) * pps;
  const step = gridSeconds(grid, project);
  const stepPx = step * pps;
  const showStep = grid !== "off" && grid !== "bar" && stepPx > 6;
  const gridBg = {
    backgroundImage: `linear-gradient(90deg, var(--grid-bar) 1px, transparent 1px)${showStep ? `, linear-gradient(90deg, var(--grid-beat) 1px, transparent 1px)` : ""}`,
    backgroundSize: `${barPx}px 100%${showStep ? `, ${stepPx}px 100%` : ""}`,
  };

  const loopVisible = project.loop[1] - project.loop[0] > 0.01;

  return (
    <div className={cx("arrange", `tool-${arrangeTool}`)} style={{ ["--header-w" as string]: `${headerW}px` }} onDragLeave={(e) => { if (e.currentTarget === e.target) { setFileDrag(false); setDropLane(null); } }}>
      <div className="arrange-tools">
        <button className="btn sm" onClick={(e) => openMenu(e, formatChoices("audio"))} title="New stereo or mono audio track. Ctrl+T adds a stereo track."><Icon name="mic" size={13} /> Audio</button>
        <button className="btn sm" onClick={() => addTrack("instrument")} title="New instrument track (Ctrl+Shift+T)"><Icon name="piano" size={13} /> Instrument</button>
        <button className="btn sm" onClick={(e) => openMenu(e, formatChoices("group"))} title="New stereo or mono bus"><Icon name="layers" size={13} /> Bus</button>
        <button className="btn sm" onClick={() => addTrack("return")} title="New FX return with reverb"><Icon name="send" size={13} /> FX Return</button>
        <button className="btn sm ghost" onClick={() => importAudio()} title="Import audio (Ctrl+I)"><Icon name="folder" size={13} /> Import</button>
        <div className="sep" />
        <button className="btn sm ghost" onClick={splitAtPlayhead} title="Split at playhead (S)"><Icon name="scissors" size={13} /></button>
        <div className="sep" />
        {(["move", "time", "split", "slip", "erase"] as ArrangeTool[]).map((id) => (
          <button key={id} className={cx("btn sm ghost", arrangeTool === id && "on")} title={TOOL_HINT[id]} onClick={() => useStore.setState({ tool: id })}>{TOOL_LABEL[id]}</button>
        ))}
        <div className="grow" />
        <span className="small faint">Snap</span>
        <select className="input sm" value={grid} onChange={(e) => useStore.setState({ grid: e.target.value as Grid })} title="Snap grid. Hold Alt while dragging to bypass">
          <option value="bar">1 Bar</option>
          <option value="1/2">1/2</option>
          <option value="beat">1/4</option>
          <option value="1/8">1/8</option>
          <option value="1/16">1/16</option>
          <option value="1/32">1/32</option>
          <option value="1/64">1/64</option>
          <option value="1/128">1/128</option>
          <option value="bart">1 Bar T</option>
          <option value="1/2t">1/2T</option>
          <option value="1/4t">1/4T</option>
          <option value="1/8t">1/8T</option>
          <option value="1/16t">1/16T</option>
          <option value="1/32t">1/32T</option>
          <option value="1/64t">1/64T</option>
          <option value="off">Off</option>
        </select>
        <button className={cx("btn sm ghost", follow && "on")} onClick={() => setFollow(!follow)} title="Follow playhead"><Icon name="arrowRight" size={13} /></button>
        <button className="btn sm ghost icon" onClick={() => useStore.setState({ pxPerSec: clamp(pps / 1.4, 4, 1200) })} title="Zoom out (-)"><Icon name="zoomOut" size={14} /></button>
        <button className="btn sm ghost icon" onClick={() => useStore.setState({ pxPerSec: clamp(pps * 1.4, 4, 1200) })} title="Zoom in (=). Ctrl+wheel zooms around the pointer"><Icon name="zoomIn" size={14} /></button>
        <button className="btn sm ghost" onClick={zoomToClips} title="Fit every clip on screen (Shift+Z)">Fit</button>
      </div>

      <div className="arrange-body" ref={body} onScroll={updateView}>
        <div className="arrange-inner" style={{ width: headerW + laneW, minWidth: "100%", minHeight: "100%" }}
          onDragOver={(e) => dragOver(e, "new")}
          onDrop={(e) => { if (!e.defaultPrevented) void onDrop(e); }}
          onPointerMove={(e) => {
            const inLanes = e.clientX - body.current!.getBoundingClientRect().left > headerW;
            reportHover(inLanes ? Math.round(timeAtClient(e.clientX) * 100) / 100 : null);
            if (inLanes && (arrangeTool === "time" || arrangeTool === "split")) setGhost(snap(timeAtClient(e.clientX), grid, project, e.altKey));
            else setGhost(null);
          }}
          onPointerLeave={() => { reportHover(null); setGhost(null); }}>
          <div className="ruler" style={{ width: headerW + laneW, minWidth: "100%" }}>
            <div className="ruler-corner">
              <span className="small faint">{tracks.length} tracks</span>
              <div className="grow" />
              <button className="btn sm ghost icon" title="Smaller tracks (Ctrl+wheel over the track names)" onClick={() => resizeAllTracks(-16)}>−</button>
              <button className="btn sm ghost icon" title="Taller tracks (Ctrl+wheel over the track names)" onClick={() => resizeAllTracks(16)}>+</button>
            </div>
            <Ruler project={project} pps={pps} view={view} grid={grid} />
          </div>

          {tracks.map((track, i) => {
            const autoKey = automationOpen[track.id];
            const trackH = heightOf(heights, track.id);
            return (
              <div key={track.id}>
                <div className={cx("track-row", (selectedTracks.includes(track.id) || (!selectedTracks.length && selectedTrack === track.id)) && "selected")} style={{ height: trackH, width: "100%" }} data-track={track.id}>
                  <TrackHeader track={track} selected={selectedTracks.includes(track.id) || selectedTrack === track.id} height={trackH} depth={depthOf(track)} />
                  <TrackDivider id={track.id} height={trackH} />
                  <div className={cx("lane", dropLane === track.id && "drop")} data-lane-index={i} data-kind={track.kind}
                    style={{ flex: "1 0 auto", width: laneW, minWidth: laneW, height: trackH, ...gridBg, backgroundColor: "var(--bg1)" }}
                    onPointerDown={(e) => onLaneDown(e, track)}
                    onDoubleClick={(e) => { if (e.target === e.currentTarget && track.kind === "instrument") addMidiClip(track.id, timeAtClient(e.clientX)); }}
                    onContextMenu={(e) => {
                      const t = timeAtClient(e.clientX);
                      openMenu(e, [
                        ...(track.kind === "instrument" ? [{ label: "New MIDI clip here", icon: "piano", run: () => addMidiClip(track.id, t) }] : []),
                        ...(track.kind === "audio" ? [{ label: "Import audio here…", icon: "folder", run: () => importAudio(track.id, snap(t, grid, project)) }] : []),
                        { label: "Paste", icon: "copy", keys: "Ctrl+V", run: () => pasteClips(snap(t, grid, project), track.id) },
                        { label: "Add marker here", icon: "info", run: () => act("marker.add", { time: snap(t, grid, project) }) },
                        { label: "Set playhead here", icon: "arrowRight", run: () => act("transport.setPosition", { time: snap(t, grid, project) }) },
                        { separator: true },
                        ...createTrackItems(track.id),
                        { label: "Duplicate track", icon: "copy", run: () => act("track.duplicate", { id: track.id }) },
                        { label: "Delete track", icon: "trash", danger: true, run: () => act("track.remove", { id: track.id }) },
                      ]);
                    }}
                    onDragOver={(e) => dragOver(e, track.id)}
                    onDrop={(e) => onDrop(e, track)}>
                    {track.clips.map((c) => (
                      <ClipView key={c.id} clip={c} track={track} pps={pps} selected={selected.has(c.id)} preview={preview} settled={settled} view={view} onDown={onClipDown} trackIndex={i} timeAt={timeAtClient} onTime={beginTime} />
                    ))}
                    {track.armed && recording && <div style={{ position: "absolute", inset: 0, background: "rgba(255,59,92,.05)", pointerEvents: "none" }} />}
                  </div>
                </div>
                {autoKey && <AutomationRow track={track} laneKey={autoKey} pps={pps} width={laneW} project={project} />}
              </div>
            );
          })}

          <MasterRow laneW={laneW} />

          <div className={cx("track-row", dropLane === "new" && "drop")} style={{ height: 120, borderBottom: "none" }}
            onDragOver={(e) => dragOver(e, "new")} onDrop={(e) => onDrop(e)}>
            <div className="add-track" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <button className="btn sm" onClick={(e) => openMenu(e, [...formatChoices("audio"), ...formatChoices("group")])}><Icon name="plus" size={13} /> Add track</button>
              <span className="small faint" style={{ padding: "4px 2px" }}>Drop audio, effects or instruments anywhere</span>
            </div>
          </div>

          {loopVisible && project.looping && (
            <div style={{ position: "absolute", top: 34, bottom: 0, left: headerW + project.loop[0] * pps, width: (project.loop[1] - project.loop[0]) * pps, background: "rgba(124,92,255,.06)", borderLeft: "1px solid rgba(124,92,255,.4)", borderRight: "1px solid rgba(124,92,255,.4)", pointerEvents: "none", zIndex: 1 }} />
          )}
          <div ref={playhead} className={cx("playhead", recording && "rec")} style={{ left: 0 }} />
          {ghost != null && (arrangeTool === "time" || arrangeTool === "split") && (
            <div className="tool-ghost" style={{ transform: `translateX(${headerW + ghost * pps}px)` }} />
          )}
          <PeerCursors pps={pps} scrollLeft={view.left} />
          {timeDrag && <div className="time-range" style={{ left: headerW + timeDrag.a * pps, width: Math.max(1, (timeDrag.b - timeDrag.a) * pps) }} />}
          {rubber && <div className="rubber" style={{ left: rubber.x, top: rubber.y, width: rubber.w, height: rubber.h }} />}
        </div>
        {!tracks.length && (
          <div className="empty" style={{ position: "absolute", inset: "34px 0 120px 0", pointerEvents: "none", zIndex: 2 }}>
            <Icon name="wave" size={36} />
            <b style={{ color: "var(--text)" }}>Your session is empty</b>
            <span>Add a track, or drop audio files here to start.</span>
            <div className="row" style={{ pointerEvents: "auto" }}><button className="btn primary" onClick={(e) => openMenu(e, formatChoices("audio"))}>Add audio track</button><button className="btn" onClick={() => addTrack("instrument")}>Add instrument</button></div>
          </div>
        )}
      </div>
      {fileDrag && <div className="drop-hint">Drop to import audio</div>}
      <div className={cx("header-resize", headerDrag && "active")} title="Drag to widen the track info. Double-click to reset."
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          const x0 = e.clientX;
          const w0 = headerRef.current;
          setHeaderDrag(true);
          const move = (ev: PointerEvent) => setHeaderWidth(w0 + ev.clientX - x0);
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            setHeaderDrag(false);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
        onDoubleClick={() => setHeaderWidth(HEADER_W_DEFAULT)} />
    </div>
  );
}
