import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { splitClipAt } from "../commands";
import { audioEditorBindings, midiEditorBindings, type EditorMode } from "../gamepad/editorPad";
import { useGamepadSurface } from "../gamepad/surfaces";
import { noteOff, noteOn } from "../keys";
import { act, onTick, useStore } from "../store";
import type { Clip, Project, Track } from "../types";
import { bendOfFade, clamp, cx, fadeInPaths, fadeOfBend, fadeOutPaths, formatDb, noteName, secondsPerBeat } from "../util";
import { ClipGain } from "./ClipGain";
import { ClipPan } from "./ClipPan";
import { openMenu } from "./ContextMenu";
import { Icon, startDrag } from "./ui";
import { Waveform } from "./Waveform";

type EditNote = { pitch: number; beat: number; len: number; vel: number };

function findClip(p: Project | null, id: string | null): { clip: Clip; track: Track } | null {
  if (!p || !id) return null;
  for (const t of p.tracks) for (const c of t.clips) if (c.id === id) return { clip: c, track: t };
  return null;
}

function Num({ label, value, onCommit, step = 0.1, min, max, suffix }: { label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(Math.round(value * 1000) / 1000)), [value]);
  const commit = () => { const n = parseFloat(v); if (Number.isFinite(n)) onCommit(clamp(n, min ?? -Infinity, max ?? Infinity)); else setV(String(value)); };
  return (
    <label className="field">
      <span>{label}</span>
      <div className="row" style={{ gap: 4 }}>
        <input className="input sm mono clip-num" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "ArrowUp") { e.preventDefault(); onCommit(clamp(value + step, min ?? -Infinity, max ?? Infinity)); } if (e.key === "ArrowDown") { e.preventDefault(); onCommit(clamp(value - step, min ?? -Infinity, max ?? Infinity)); } }} />
        {suffix && <span className="small faint">{suffix}</span>}
      </div>
    </label>
  );
}

function AudioInspector({ clip, project }: { clip: Clip; project: Project }) {
  const loop = project.loop;
  const [stretch, setStretch] = useState(String((clip.end - clip.start).toFixed(3)));
  useEffect(() => setStretch(String((clip.end - clip.start).toFixed(3))), [clip.end, clip.start]);
  const scroller = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [scroll, setScroll] = useState(0);
  const [liveGain, setLiveGain] = useState<[number, number][] | null>(null);
  const [liveFade, setLiveFade] = useState<{ fadeIn: number; fadeOut: number; inBend: number; outBend: number } | null>(null);
  useGamepadSurface({
    id: "editor-audio",
    region: "editor",
    active: () => true,
    bindings: () => audioEditorBindings(clip),
  });
  useEffect(() => { setZoom(1); setScroll(0); setLiveGain(null); setLiveFade(null); }, [clip.id]);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => scroller.current && setW(scroller.current.clientWidth));
    if (scroller.current) ro.observe(scroller.current);
    return () => ro.disconnect();
  }, []);
  const len = clip.end - clip.start;
  const fit = Math.max(8, (Math.max(80, w) - 2) / Math.max(0.1, len));
  const pps = fit * zoom;
  const contentW = zoom <= 1 ? Math.max(80, w) : Math.ceil(len * pps);
  const playhead = useRef<HTMLDivElement>(null);
  useEffect(() => onTick((t) => {
    if (!playhead.current) return;
    const x = (t.t - clip.start) * pps;
    playhead.current.style.display = x >= -1 && x <= contentW + 1 ? "block" : "none";
    playhead.current.style.transform = `translateX(${x}px)`;
  }) as () => void, [clip.start, pps, contentW]);

  return (
    <div className="editor">
      <div className="inspector">
        <div className="section-title">Audio clip</div>
        <label className="field"><span>Name</span><input className="input sm" defaultValue={clip.name} key={clip.id + clip.name} onBlur={(e) => e.target.value !== clip.name && act("clip.set", { id: clip.id, name: e.target.value })} /></label>
        <div className="row">
          <Num label="Gain" value={clip.gainDb ?? 0} step={0.5} min={-48} max={24} suffix="dB" onCommit={(v) => act("clip.set", { id: clip.id, gainDb: v })} />
          <Num label="Pitch" value={clip.pitch ?? 0} step={1} min={-24} max={24} suffix="st" onCommit={(v) => act("clip.set", { id: clip.id, pitch: v })} />
        </div>
        <div className="row">
          <Num label="Fade in" value={clip.fadeIn ?? 0} step={0.05} min={0} max={len} suffix="s" onCommit={(v) => act("clip.set", { id: clip.id, fadeIn: v })} />
          <Num label="Fade out" value={clip.fadeOut ?? 0} step={0.05} min={0} max={len} suffix="s" onCommit={(v) => act("clip.set", { id: clip.id, fadeOut: v })} />
        </div>
        <label className="field"><span>Fade shape</span>
          <select className="input sm" value={clip.fadeInType ?? "linear"} onChange={(e) => act("clip.set", { id: clip.id, fadeInType: e.target.value, fadeOutType: e.target.value })}>
            <option value="linear">Linear</option><option value="convex">Convex</option><option value="concave">Concave</option><option value="scurve">S-curve</option>
          </select>
        </label>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className={cx("btn sm", clip.reversed && "on")} onClick={() => act("clip.set", { id: clip.id, reversed: !clip.reversed })}>Reverse</button>
          <button className={cx("btn sm", clip.autoTempo && "on")} title="Follow project tempo changes (time-stretch)" onClick={() => act("clip.set", { id: clip.id, autoTempo: !clip.autoTempo })}>Follow tempo</button>
          <button className={cx("btn sm", clip.muted && "on")} onClick={() => act("clip.set", { id: clip.id, muted: !clip.muted })}>Mute</button>
          <button className="btn sm" title="Set clip gain so the peak reaches -1 dBFS" onClick={() => act("clip.normalize", { id: clip.id, peakDb: -1 })}>Normalize</button>
        </div>
        <div className="field">
          <span>Time-stretch to length (keeps pitch)</span>
          <div className="row">
            <input className="input sm grow mono" value={stretch} onChange={(e) => setStretch(e.target.value)} />
            <span className="small faint">s</span>
            <button className="btn sm" onClick={() => { const l = parseFloat(stretch); if (l > 0.05) act("clip.stretch", { id: clip.id, length: l }); }}>Stretch</button>
          </div>
          <div className="row">
            <button className="btn sm grow" onClick={() => act("clip.stretch", { id: clip.id, length: len * 2 })}>½× speed</button>
            <button className="btn sm grow" onClick={() => act("clip.stretch", { id: clip.id, length: len / 2 })}>2× speed</button>
          </div>
        </div>
        {clip.takes && clip.takes.count > 1 && (
          <div className="field">
            <span>Takes ({clip.takes.count}) · comp with the loop range</span>
            <div className="col" style={{ gap: 4 }}>
              {Array.from({ length: clip.takes.count }, (_, i) => (
                <div key={i} className="row" style={{ gap: 4 }}>
                  <button className={cx("btn sm grow", clip.takes!.current === i && "on")} onClick={() => act("clip.set", { id: clip.id, take: i })}>{clip.takes!.names?.[i] || `Take ${i + 1}`}</button>
                  <button className="btn sm" title={`Use this take between ${loop[0].toFixed(2)}s and ${loop[1].toFixed(2)}s`}
                    disabled={loop[1] - loop[0] < 0.05} onClick={() => act("clip.comp", { id: clip.id, start: loop[0], end: loop[1], take: i })}>Comp range</button>
                </div>
              ))}
              <button className="btn sm danger" onClick={() => act("clip.flattenTakes", { id: clip.id })}>Keep current take only</button>
            </div>
          </div>
        )}
        <span className="small faint ellipsis" title={clip.file}>{clip.file?.split(/[\\/]/).pop()} · {clip.channels === 1 ? "mono" : "stereo"} · {(clip.sourceLength ?? 0).toFixed(2)} s source</span>
      </div>
      <div className="col grow" style={{ minWidth: 0, minHeight: 0, gap: 0 }}>
        <div className="row" style={{ padding: "6px 10px", gap: 6, borderBottom: "1px solid var(--line)" }}>
          <span className="small faint">Waveform</span>
          <div className="grow" />
          <button className="btn sm ghost icon" title="Zoom out" onClick={() => setZoom((z) => clamp(z / 1.4, 1, 32))}><Icon name="zoomOut" size={13} /></button>
          <button className="btn sm ghost icon" title="Zoom in" onClick={() => setZoom((z) => clamp(z * 1.4, 1, 32))}><Icon name="zoomIn" size={13} /></button>
          <button className="btn sm ghost" title="Fit the clip" onClick={() => { setZoom(1); if (scroller.current) scroller.current.scrollLeft = 0; setScroll(0); }}>Fit</button>
        </div>
        <div ref={scroller} className="grow" style={{ position: "relative", overflowX: "auto", overflowY: "hidden", minWidth: 0, padding: 12 }}
          onScroll={(e) => setScroll(e.currentTarget.scrollLeft)}>
          <div className="editor-clip" style={{ width: contentW, cursor: "pointer", background: "linear-gradient(180deg, rgba(124,92,255,.25), rgba(124,92,255,.08))", border: "1px solid rgba(124,92,255,.5)" }}
            onPointerDown={(e) => { if (e.button !== 0) return; const r = e.currentTarget.getBoundingClientRect(); act("transport.setPosition", { time: clip.start + (e.clientX - r.left) / pps }); }}
            onContextMenu={(e) => {
              const here = clip.start + (e.clientX - e.currentTarget.getBoundingClientRect().left) / pps;
              openMenu(e, [
                { label: "Open in editor", icon: "wave", run: () => useStore.setState({ editorClip: clip.id, bottom: "editor", selectedClips: [clip.id] }) },
                { separator: true },
                { label: "Split here", icon: "scissors", run: () => splitClipAt(clip.id, here) },
                { label: "Duplicate", icon: "copy", keys: "Ctrl+D", run: () => act("clip.duplicate", { id: clip.id }) },
                { label: clip.muted ? "Unmute" : "Mute", icon: "power", keys: "Shift+M", run: () => act("clip.set", { id: clip.id, muted: !clip.muted }) },
                { label: "Normalize to −1 dB", icon: "wave", run: () => act("clip.normalize", { id: clip.id, peakDb: -1 }) },
                { separator: true },
                { label: "Delete", icon: "trash", danger: true, keys: "Del", run: () => act("clip.delete", { id: clip.id }) },
              ]);
            }}>
            <div className="clip-label">{clip.name} · gain {formatDb(clip.gainDb ?? 0)} dB</div>
            <Waveform clip={{
              ...clip,
              gainPoints: (liveGain ?? clip.gainPoints),
              fadeIn: liveFade?.fadeIn ?? clip.fadeIn,
              fadeOut: liveFade?.fadeOut ?? clip.fadeOut,
              fadeInType: liveFade ? fadeOfBend(liveFade.inBend) : clip.fadeInType,
              fadeOutType: liveFade ? fadeOfBend(liveFade.outBend) : clip.fadeOutType,
            }} pxPerSec={pps} colour="rgba(255,255,255,.85)" viewLeft={scroll} viewWidth={w} clipLeft={0} />
            <ClipGain id={clip.id} points={clip.gainPoints} duration={len} offsetDelta={0} onDraft={setLiveGain} />
            <ClipPan id={clip.id} points={clip.panPoints} duration={len} offsetDelta={0} onDraft={() => {}} />
            <svg className="fades" preserveAspectRatio="none" viewBox="0 0 100 100">
              {(() => {
                const inn = liveFade?.fadeIn ?? clip.fadeIn ?? 0;
                const out = liveFade?.fadeOut ?? clip.fadeOut ?? 0;
                const inBend = liveFade?.inBend ?? bendOfFade(clip.fadeInType);
                const outBend = liveFade?.outBend ?? bendOfFade(clip.fadeOutType);
                const innPaths = fadeInPaths((inn / Math.max(0.001, len)) * 100, inBend);
                const outPaths = fadeOutPaths((1 - out / Math.max(0.001, len)) * 100, outBend);
                return <>
                  {inn > 0 && <path d={innPaths.shade} fill="rgba(0,0,0,.35)" />}
                  {out > 0 && <path d={outPaths.shade} fill="rgba(0,0,0,.35)" />}
                  {inn > 0 && <path className="fade-edge" d={innPaths.edge} />}
                  {out > 0 && <path className="fade-edge" d={outPaths.edge} />}
                </>;
              })()}
            </svg>
            <div className="fade-h in" title="Fade in. Drag right to change the length. Drag up or down to make it steeper, straighter, or lighter."
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                const startIn = clip.fadeIn ?? 0;
                const startOut = clip.fadeOut ?? 0;
                const startBend = bendOfFade(clip.fadeInType);
                let next = startIn;
                let bend = startBend;
                startDrag(e, (dx, dy) => {
                  next = clamp(startIn + dx / pps, 0, len);
                  bend = clamp(startBend - dy / 70, -1, 1);
                  setLiveFade({ fadeIn: next, fadeOut: startOut, inBend: bend, outBend: bendOfFade(clip.fadeOutType) });
                }, () => { setLiveFade(null); act("clip.set", { id: clip.id, fadeIn: next, fadeInType: fadeOfBend(bend) }); });
              }}>IN</div>
            <div className="fade-h out" title="Fade out. Drag left to change the length. Drag up or down to make it steeper, straighter, or lighter."
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                const startIn = clip.fadeIn ?? 0;
                const startOut = clip.fadeOut ?? 0;
                const startBend = bendOfFade(clip.fadeOutType);
                let next = startOut;
                let bend = startBend;
                startDrag(e, (dx, dy) => {
                  next = clamp(startOut - dx / pps, 0, len);
                  bend = clamp(startBend - dy / 70, -1, 1);
                  setLiveFade({ fadeIn: startIn, fadeOut: next, inBend: bendOfFade(clip.fadeInType), outBend: bend });
                }, () => { setLiveFade(null); act("clip.set", { id: clip.id, fadeOut: next, fadeOutType: fadeOfBend(bend) }); });
              }}>OUT</div>
            <div ref={playhead} className="playhead" />
          </div>
        </div>
      </div>
    </div>
  );
}

const GRIDS = [{ v: 1, l: "1/4" }, { v: 0.5, l: "1/8" }, { v: 0.25, l: "1/16" }, { v: 0.125, l: "1/32" }, { v: 1 / 3, l: "1/4T" }, { v: 1 / 6, l: "1/8T" }];
const ROW = 14;

function PianoRoll({ clip, project }: { clip: Clip; project: Project }) {
  const spb = secondsPerBeat(project);
  const clipBeats = (clip.end - clip.start) / spb;
  const fromClip = (c: Clip): EditNote[] => (c.notes ?? []).map((n) => ({ pitch: n[0], beat: n[4], len: n[5], vel: n[3] }));
  const [notes, setNotes] = useState<EditNote[]>(() => fromClip(clip));
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [ppb, setPpb] = useState(56);
  const [grid, setGrid] = useState(0.25);
  const [noteLen, setNoteLen] = useState(1);
  const mode = useRef<EditorMode>("draw");
  const cursorPitch = useRef(60);
  const acc = useRef({ beat: 0, pitch: 0, len: 0, vel: 0 });
  const scroller = useRef<HTMLDivElement>(null);
  const keys = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);

  useEffect(() => { if (!dirty.current) setNotes(fromClip(clip)); }, [clip.notes]);
  useEffect(() => { setSel(new Set()); dirty.current = false; setNotes(fromClip(clip)); }, [clip.id]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const pitches = (clip.notes ?? []).map((n) => n[0]);
    const centre = pitches.length ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : 62;
    el.scrollTop = (127 - centre) * ROW - el.clientHeight / 2;
  }, [clip.id]);

  const commit = (next: EditNote[]) => {
    dirty.current = false;
    setNotes(next);
    act("midi.setNotes", { clipId: clip.id, notes: next.map((n) => [n.pitch, n.beat, n.len, n.vel]) });
  };

  useGamepadSurface({
    id: "editor-midi",
    region: "editor",
    active: () => true,
    bindings: () => midiEditorBindings({
      clip, project, notes, sel, grid, noteLen, mode, cursorPitch, acc: acc.current,
      commit, setNotes, setSel, setNoteLen, scroller,
    }),
  });

  const snapB = (b: number, bypass: boolean) => (bypass ? Math.max(0, b) : Math.max(0, Math.round(b / grid) * grid));
  const totalBeats = Math.max(clipBeats + 8, 32);
  const width = totalBeats * ppb;
  const beatsPerBar = project.timeSig[0] * (4 / project.timeSig[1]);

  const playhead = useRef<HTMLDivElement>(null);
  useEffect(() => onTick((t) => {
    if (playhead.current) playhead.current.style.transform = `translateX(${((t.t - clip.start) / spb) * ppb}px)`;
  }) as () => void, [clip.start, spb, ppb]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") return;
      if (!sel.size) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); e.stopImmediatePropagation(); commit(notes.filter((_, i) => !sel.has(i))); setSel(new Set()); }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault(); e.stopImmediatePropagation();
        const d = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1);
        commit(notes.map((n, i) => (sel.has(i) ? { ...n, pitch: clamp(n.pitch + d, 0, 127) } : n)));
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault(); e.stopImmediatePropagation();
        const d = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 1 : grid);
        commit(notes.map((n, i) => (sel.has(i) ? { ...n, beat: Math.max(0, n.beat + d) } : n)));
      }
      if (e.ctrlKey && e.key.toLowerCase() === "a") { e.preventDefault(); e.stopImmediatePropagation(); setSel(new Set(notes.map((_, i) => i))); }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [sel, notes, grid]);

  const gridBg = {
    backgroundImage: `linear-gradient(90deg, var(--grid-bar) 1px, transparent 1px), linear-gradient(90deg, var(--grid-beat) 1px, transparent 1px), linear-gradient(90deg, var(--grid-beat) 1px, transparent 1px)`,
    backgroundSize: `${beatsPerBar * ppb}px 100%, ${ppb}px 100%, ${grid * ppb}px 100%`,
  };

  const onGridDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const beat = snapB((e.clientX - r.left) / ppb, e.altKey);
    const pitch = 127 - Math.floor((e.clientY - r.top) / ROW);
    if (!e.shiftKey) {
      const next = [...notes, { pitch, beat: Math.floor(beat / grid) * grid, len: noteLen, vel: 100 }];
      setSel(new Set([next.length - 1]));
      commit(next);
    } else setSel(new Set());
  };

  const onNoteDown = (e: React.PointerEvent, i: number, mode: "move" | "len") => {
    e.stopPropagation();
    if (e.button === 2) return;
    let ids = sel;
    if (e.shiftKey) { ids = new Set(sel); ids.has(i) ? ids.delete(i) : ids.add(i); setSel(ids); }
    else if (!sel.has(i)) { ids = new Set([i]); setSel(ids); }
    const base = notes;
    let next = base;
    let moved = false;
    startDrag(e, (dx, dy, ev) => {
      moved = true;
      dirty.current = true;
      const db = ev.altKey ? dx / ppb : Math.round(dx / ppb / grid) * grid;
      const dp = -Math.round(dy / ROW);
      const src = e.ctrlKey && mode === "move" ? [...base, ...[...ids].map((j) => ({ ...base[j] }))] : base;
      const targets = e.ctrlKey && mode === "move" ? new Set([...ids].map((_, k) => base.length + k)) : ids;
      next = src.map((n, j) => {
        if (!targets.has(j)) return n;
        if (mode === "len") return { ...n, len: Math.max(grid / 2, ev.altKey ? n.len + dx / ppb : Math.round((n.len + dx / ppb) / grid) * grid || grid) };
        return { ...n, beat: Math.max(0, n.beat + db), pitch: clamp(n.pitch + dp, 0, 127) };
      });
      setNotes(next);
    }, () => {
      if (moved) { commit(next); if (mode === "len") setNoteLen(next[i].len); }
      else if (!e.shiftKey) setNoteLen(base[i].len);
    });
  };

  const velH = 64;

  return (
    <div className="col grow" style={{ minWidth: 0, gap: 0 }}>
      <div className="row" style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)" }}>
        <b>{clip.name}</b>
        <span className="small faint">{notes.length} notes · {clipBeats.toFixed(1)} beats</span>
        <div className="grow" />
        <span className="small faint">Grid</span>
        <select className="input sm" value={grid} onChange={(e) => setGrid(+e.target.value)}>
          {GRIDS.map((g) => <option key={g.l} value={g.v}>{g.l}</option>)}
        </select>
        <button className="btn sm" title="Quantize note starts to the grid" onClick={() => act("midi.quantize", { clipId: clip.id, grid })}>Quantize</button>
        <button className="btn sm" title="Transpose down an octave" onClick={() => act("midi.transpose", { clipId: clip.id, semitones: -12 })}>−8va</button>
        <button className="btn sm" title="Transpose up an octave" onClick={() => act("midi.transpose", { clipId: clip.id, semitones: 12 })}>+8va</button>
        <button className="btn sm ghost icon" title="Zoom out" onClick={() => setPpb((p) => clamp(p / 1.3, 12, 400))}><Icon name="zoomOut" size={13} /></button>
        <button className="btn sm ghost icon" title="Zoom in" onClick={() => setPpb((p) => clamp(p * 1.3, 12, 400))}><Icon name="zoomIn" size={13} /></button>
        <button className="btn sm ghost" title="Fit the clip" onClick={() => {
          const view = scroller.current?.clientWidth ?? 600;
          setPpb(clamp((view - 24) / Math.max(1, clipBeats), 12, 400));
        }}>Fit</button>
      </div>
      <div className="piano grow">
        <div className="piano-keys" ref={keys}>
          <div style={{ height: 128 * ROW, position: "relative" }}>
            {Array.from({ length: 128 }, (_, k) => {
              const pitch = 127 - k;
              const black = [1, 3, 6, 8, 10].includes(pitch % 12);
              return (
                <div key={pitch} style={{ position: "absolute", top: k * ROW, height: ROW, left: 0, right: black ? 18 : 0, background: black ? "#11141c" : "#d9dce6", borderBottom: "1px solid rgba(0,0,0,.25)", color: "#333", fontSize: 9, paddingLeft: 4, lineHeight: `${ROW}px`, cursor: "pointer" }}
                  title={noteName(pitch)}
                  onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); noteOn(pitch); }}
                  onPointerUp={() => noteOff(pitch)}
                  onPointerCancel={() => noteOff(pitch)}>
                  {pitch % 12 === 0 ? noteName(pitch) : ""}
                </div>
              );
            })}
          </div>
        </div>
        <div className="piano-grid" ref={scroller} onScroll={(e) => { if (keys.current) keys.current.scrollTop = e.currentTarget.scrollTop; }}>
          <div style={{ width, height: 128 * ROW, position: "relative", ...gridBg }} onPointerDown={onGridDown} onContextMenu={(e) => e.preventDefault()}>
            {Array.from({ length: 128 }, (_, k) => [1, 3, 6, 8, 10].includes((127 - k) % 12) && (
              <div key={k} style={{ position: "absolute", top: k * ROW, height: ROW, left: 0, right: 0, background: "rgba(0,0,0,.18)", pointerEvents: "none" }} />
            ))}
            <div style={{ position: "absolute", left: clipBeats * ppb, top: 0, bottom: 0, right: 0, background: "rgba(0,0,0,.35)", pointerEvents: "none", borderLeft: "1px solid var(--violet)" }} />
            {notes.map((n, i) => (
              <div key={i} className={cx("note", sel.has(i) && "selected")}
                style={{ left: n.beat * ppb, top: (127 - n.pitch) * ROW + 1, width: Math.max(4, n.len * ppb - 1), height: ROW - 2, opacity: 0.45 + (n.vel / 127) * 0.55 }}
                title={`${noteName(n.pitch)} · velocity ${n.vel}`}
                onPointerDown={(e) => onNoteDown(e, i, "move")}
                onDoubleClick={(e) => { e.stopPropagation(); commit(notes.filter((_, j) => j !== i)); setSel(new Set()); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); commit(notes.filter((_, j) => j !== i)); setSel(new Set()); }}>
                <div className="nr" onPointerDown={(e) => onNoteDown(e, i, "len")} />
              </div>
            ))}
            <div ref={playhead} className="playhead" style={{ left: 0 }} />
          </div>
          <div style={{ position: "sticky", bottom: 0, width, height: velH, background: "rgba(10,12,18,.96)", borderTop: "1px solid var(--line2)", zIndex: 3 }}
            title="Velocity. Drag a bar up or down"
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const apply = (cx: number, cy: number) => {
                const beat = (cx - r.left) / ppb;
                const vel = clamp(Math.round((1 - (cy - r.top) / velH) * 127), 1, 127);
                let next = notes;
                const targets = sel.size ? notes.map((n, i) => (sel.has(i) && Math.abs(n.beat - beat) < 0.5 ? i : -1)).filter((i) => i >= 0) : [];
                const hit = targets.length ? targets : notes.map((n, i) => (beat >= n.beat && beat <= n.beat + Math.max(n.len, 0.25) ? i : -1)).filter((i) => i >= 0);
                next = notes.map((n, i) => (hit.includes(i) ? { ...n, vel } : n));
                return next;
              };
              let next = apply(e.clientX, e.clientY);
              dirty.current = true;
              setNotes(next);
              startDrag(e, (_dx, _dy, ev) => { next = apply(ev.clientX, ev.clientY); setNotes(next); }, () => commit(next));
            }}>
            {notes.map((n, i) => (
              <div key={i} style={{ position: "absolute", left: n.beat * ppb, bottom: 0, width: 5, height: (n.vel / 127) * (velH - 6), background: sel.has(i) ? "#fff" : "var(--cyan)", borderRadius: 2, pointerEvents: "none" }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Editor() {
  const project = useStore((s) => s.project);
  const editorClip = useStore((s) => s.editorClip);
  const selectedClips = useStore((s) => s.selectedClips);
  const id = editorClip ?? selectedClips[0] ?? null;
  const found = useMemo(() => findClip(project, id), [project, id]);

  if (!found || !project) {
    return (
      <div className="empty">
        <Icon name="piano" size={30} />
        <span>Double-click a clip to edit it here.<br />Audio clips get gain, fades, stretch and take comping; MIDI clips open in the piano roll.</span>
      </div>
    );
  }
  if (found.clip.kind === "midi") return <PianoRoll clip={found.clip} project={project} />;
  if (found.clip.kind === "audio") return <AudioInspector clip={found.clip} project={project} />;
  return <div className="empty">This clip type has no editor.</div>;
}
