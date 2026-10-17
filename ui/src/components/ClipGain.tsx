import { useEffect, useRef, useState } from "react";
import { act } from "../store";
import { clamp, clipGainDbAt, formatDb } from "../util";
import { startDrag } from "./ui";

const TOP_DB = 12;
const BOTTOM_DB = -24;

function yOf(db: number) {
  return ((TOP_DB - clamp(db, BOTTOM_DB, TOP_DB)) / (TOP_DB - BOTTOM_DB)) * 100;
}

function dbOf(yFraction: number) {
  return clamp(TOP_DB - yFraction * (TOP_DB - BOTTOM_DB), BOTTOM_DB, TOP_DB);
}

function samePoints(a: [number, number][] | undefined, b: [number, number][]) {
  const left = a ?? [];
  if (left.length !== b.length) return false;
  const sa = [...left].sort((p, q) => p[0] - q[0]);
  const sb = [...b].sort((p, q) => p[0] - q[0]);
  return sa.every((p, i) => Math.abs(p[0] - sb[i][0]) < 0.01 && Math.abs(p[1] - sb[i][1]) < 0.08);
}

/** The horizontal gain line on an audio clip. Click it to add a point, drag a point, double-click to remove it. */
export function ClipGain({ id, points, duration, offsetDelta, onDraft }: {
  id: string;
  points: [number, number][] | undefined;
  duration: number;
  /** How far the audio has slipped or been trimmed compared with the stored points. */
  offsetDelta: number;
  onDraft: (points: [number, number][] | null) => void;
}) {
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const [readout, setReadout] = useState<{ t: number; db: number } | null>(null);
  const draftNotify = useRef(onDraft);
  draftNotify.current = onDraft;
  const stored = draft ?? points ?? [];
  const visible = stored.map(([t, db]) => [t - offsetDelta, db] as [number, number]);
  const span = Math.max(0.02, duration);

  useEffect(() => {
    if (!draft) return;
    if (samePoints(points, draft)) {
      setDraft(null);
      draftNotify.current(null);
      return;
    }
    const timer = window.setTimeout(() => { setDraft(null); draftNotify.current(null); }, 500);
    return () => window.clearTimeout(timer);
  }, [points, draft]);

  const commit = (next: [number, number][]) => {
    const sorted = [...next].sort((a, b) => a[0] - b[0]);
    setDraft(sorted);
    onDraft(sorted);
    void act("clip.setGainPoints", { id, points: sorted });
  };

  const place = (e: { clientX: number; clientY: number }, box: DOMRect) => {
    const visibleT = clamp((e.clientX - box.left) / Math.max(1, box.width), 0, 1) * span;
    const db = dbOf((e.clientY - box.top) / Math.max(1, box.height));
    return { visibleT, storedT: visibleT + offsetDelta, db };
  };

  const samples = () => {
    const times = new Set<number>([0, span]);
    for (const [t] of visible) if (t > 0 && t < span) times.add(t);
    return [...times].sort((a, b) => a - b).map((t) => `${(t / span) * 100},${yOf(clipGainDbAt(visible, t))}`).join(" ");
  };

  const onLineDown = (e: React.PointerEvent<SVGPolylineElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    const first = place(e, box);
    let next = [...stored, [first.storedT, first.db] as [number, number]];
    setDraft(next);
    onDraft(next);
    setReadout({ t: first.visibleT, db: first.db });
    startDrag(e, (_dx, _dy, ev) => {
      const at = place(ev, box);
      next = [...stored, [at.storedT, at.db] as [number, number]];
      setDraft(next);
      onDraft(next);
      setReadout({ t: at.visibleT, db: at.db });
    }, () => { setReadout(null); commit(next); });
  };

  const onPointDown = (e: React.PointerEvent, index: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const others = stored.filter((_, i) => i !== index);
    let next = stored;
    startDrag(e, (_dx, _dy, ev) => {
      const at = place(ev, box);
      next = [...others, [at.storedT, at.db] as [number, number]];
      setDraft(next);
      onDraft(next);
      setReadout({ t: at.visibleT, db: at.db });
    }, () => { setReadout(null); commit(next); });
  };

  return (
    <div className="gain-line" title="Clip gain. Click the line to add a point, drag it, double-click a point to remove it.">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline className="gain-shadow" points={samples()} fill="none" stroke="rgba(0,0,0,.55)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        <polyline points={samples()} fill="none" stroke="#fff6c2" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <polyline className="gain-hit" points={samples()} fill="none" stroke="transparent" strokeWidth="14" vectorEffect="non-scaling-stroke"
          onPointerDown={onLineDown} onDoubleClick={(e) => e.stopPropagation()} />
      </svg>
      {visible.map(([t, db], i) => t < -0.001 || t > span + 0.001 ? null : (
        <div key={`${stored[i]?.[0] ?? t}-${i}`} className="gain-pt" style={{ left: `${(t / span) * 100}%`, top: `${yOf(db)}%` }}
          title={`${formatDb(db)} dB. Double-click to remove.`}
          onPointerDown={(e) => onPointDown(e, i)}
          onDoubleClick={(e) => { e.stopPropagation(); commit(stored.filter((_, n) => n !== i)); }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); commit(stored.filter((_, n) => n !== i)); }} />
      ))}
      {readout && (
        <span className="gain-readout" style={{ left: `${(readout.t / span) * 100}%`, top: `${yOf(readout.db)}%` }}>{formatDb(readout.db)}</span>
      )}
    </div>
  );
}
