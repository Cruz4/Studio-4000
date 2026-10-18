import { useEffect, useRef, useState } from "react";
import { act } from "../store";
import { clamp, clipGainDbAt } from "../util";
import { startDrag } from "./ui";

function yOf(pan: number) {
  return ((1 - clamp(pan, -1, 1)) / 2) * 100;
}

function panOf(yFraction: number) {
  return Math.round(clamp(1 - yFraction * 2, -1, 1) * 100) / 100;
}

export function panText(pan: number) {
  const n = Math.round(Math.abs(pan) * 100);
  if (n < 1) return "C";
  return pan < 0 ? `L${n}` : `R${n}`;
}

function samePoints(a: [number, number][] | undefined, b: [number, number][]) {
  const left = a ?? [];
  if (left.length !== b.length) return false;
  const sa = [...left].sort((p, q) => p[0] - q[0]);
  const sb = [...b].sort((p, q) => p[0] - q[0]);
  return sa.every((p, i) => Math.abs(p[0] - sb[i][0]) < 0.01 && Math.abs(p[1] - sb[i][1]) < 0.01);
}

/** The horizontal pan line on an audio clip. Right is the top, left is the bottom, center is the middle. */
export function ClipPan({ id, points, duration, offsetDelta, onDraft }: {
  id: string;
  points: [number, number][] | undefined;
  duration: number;
  offsetDelta: number;
  onDraft: (points: [number, number][] | null) => void;
}) {
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const [readout, setReadout] = useState<{ t: number; pan: number } | null>(null);
  const draftNotify = useRef(onDraft);
  draftNotify.current = onDraft;
  const stored = draft ?? points ?? [];
  const visible = stored.map(([t, pan]) => [t - offsetDelta, pan] as [number, number]);
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
    void act("clip.setPanPoints", { id, points: sorted });
  };

  const place = (e: { clientX: number; clientY: number }, box: DOMRect) => {
    const visibleT = clamp((e.clientX - box.left) / Math.max(1, box.width), 0, 1) * span;
    const pan = panOf((e.clientY - box.top) / Math.max(1, box.height));
    return { visibleT, storedT: visibleT + offsetDelta, pan };
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
    let next = [...stored, [first.storedT, first.pan] as [number, number]];
    setDraft(next);
    onDraft(next);
    setReadout({ t: first.visibleT, pan: first.pan });
    startDrag(e, (_dx, _dy, ev) => {
      const at = place(ev, box);
      next = [...stored, [at.storedT, at.pan] as [number, number]];
      setDraft(next);
      onDraft(next);
      setReadout({ t: at.visibleT, pan: at.pan });
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
      next = [...others, [at.storedT, at.pan] as [number, number]];
      setDraft(next);
      onDraft(next);
      setReadout({ t: at.visibleT, pan: at.pan });
    }, () => { setReadout(null); commit(next); });
  };

  return (
    <div className="gain-line pan-line" title="Clip pan. The top is right, the bottom is left. Click the line to add a point, drag it, double-click a point to remove it.">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline className="gain-shadow" points={samples()} fill="none" stroke="rgba(0,0,0,.55)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        <polyline points={samples()} fill="none" stroke="#7ee7ff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <polyline className="gain-hit" points={samples()} fill="none" stroke="transparent" strokeWidth="14" vectorEffect="non-scaling-stroke"
          onPointerDown={onLineDown} onDoubleClick={(e) => e.stopPropagation()} />
      </svg>
      {visible.map(([t, pan], i) => t < -0.001 || t > span + 0.001 ? null : (
        <div key={`${stored[i]?.[0] ?? t}-${i}`} className="gain-pt" style={{ left: `${(t / span) * 100}%`, top: `${yOf(pan)}%` }}
          title={`${panText(pan)}. Double-click to remove.`}
          onPointerDown={(e) => onPointDown(e, i)}
          onDoubleClick={(e) => { e.stopPropagation(); commit(stored.filter((_, n) => n !== i)); }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); commit(stored.filter((_, n) => n !== i)); }} />
      ))}
      {readout && (
        <span className="gain-readout pan-readout" style={{ left: `${(readout.t / span) * 100}%`, top: `${yOf(readout.pan)}%` }}>{panText(readout.pan)}</span>
      )}
    </div>
  );
}
