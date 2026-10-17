import { useEffect, useRef, useState } from "react";
import type { Clip } from "../types";
import { cachedPeaks, clipGainDbAt, loadPeaks, type Peaks } from "../util";

/** Draws the part of an audio clip that is visible in the scroll viewport. */
export function Waveform({ clip, pxPerSec, colour, viewLeft, viewWidth, clipLeft }: {
  clip: Clip; pxPerSec: number; colour: string; viewLeft: number; viewWidth: number; clipLeft: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const speed = clip.speed || 1;
  const width = (clip.end - clip.start) * pxPerSec;
  const visStart = Math.max(0, viewLeft - clipLeft - 200);
  const visEnd = Math.min(width, viewLeft + viewWidth - clipLeft + 200);
  const drawW = Math.max(0, Math.ceil(visEnd - visStart));
  const span = Math.max(0.05, (Math.max(1, drawW) / Math.max(1, pxPerSec)) * speed);
  const t0 = Math.max(0, clip.offset + (visStart / Math.max(1, pxPerSec)) * speed);
  const want = Math.min(8000, Math.max(48, Math.ceil(pxPerSec / speed)));
  const detail = want > 240;
  const bucket = Math.max(0.05, span);
  const q0 = detail ? Math.max(0, Math.floor(Math.max(0, t0 - span * 0.35) / bucket) * bucket) : 0;
  const qLen = detail ? bucket * 2.2 : 0;
  const overviewKey = `${clip.file}#${Math.round((clip.sourceLength ?? 0) * 10)}`;
  const key = detail ? `${clip.file}@${want}|${q0.toFixed(2)}|${qLen.toFixed(2)}` : overviewKey;
  const [peaks, setPeaks] = useState<Peaks | null>(() => (clip.file ? cachedPeaks(key) ?? cachedPeaks(overviewKey) ?? null : null));

  useEffect(() => {
    if (!clip.file) return;
    const cached = cachedPeaks(key) ?? cachedPeaks(overviewKey);
    if (cached) setPeaks(cached);
    let alive = true;
    loadPeaks(clip.file, key, detail ? { start: q0, length: qLen, binsPerSecond: want } : undefined)
      .then((p) => { if (alive && p) setPeaks(p); });
    return () => { alive = false; };
  }, [clip.file, key, detail, q0, qLen, want, overviewKey]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks || drawW <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const h = c.clientHeight || 40;
    c.width = Math.ceil(drawW * dpr);
    c.height = Math.ceil(h * dpr);
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, drawW, h);

    const gain = Math.pow(10, (clip.gainDb ?? 0) / 20);
    const envelope = clip.gainPoints;
    const mid = h / 2;
    const scale = (h / 2 - 1) / 127 * Math.min(gain, 4);
    const bins = peaks.data.length / 2;
    const origin = peaks.start ?? 0;
    const fadeIn = (clip.fadeIn ?? 0) * pxPerSec, fadeOut = (clip.fadeOut ?? 0) * pxPerSec;

    g.fillStyle = colour;
    g.beginPath();
    for (let x = 0; x < drawW; x++) {
      const px = visStart + x;
      let t0s = clip.offset + (px / pxPerSec) * speed;
      let t1s = clip.offset + ((px + 1) / pxPerSec) * speed;
      if (clip.reversed && clip.sourceLength) { const a = clip.sourceLength - t1s, b = clip.sourceLength - t0s; t0s = a; t1s = b; }
      let b0 = Math.floor((t0s - origin) * peaks.binsPerSecond);
      let b1 = Math.max(b0 + 1, Math.floor((t1s - origin) * peaks.binsPerSecond));
      if (b0 >= bins || b1 <= 0) continue;
      b0 = Math.max(0, b0); b1 = Math.min(bins, b1);
      let lo = 0, hi = 0;
      for (let b = b0; b < b1; b++) {
        const l = peaks.data[b * 2], u = peaks.data[b * 2 + 1];
        if (l < lo) lo = l;
        if (u > hi) hi = u;
      }
      let env = Math.pow(10, clipGainDbAt(envelope, px / pxPerSec) / 20);
      if (fadeIn > 0 && px < fadeIn) env *= px / fadeIn;
      if (fadeOut > 0 && px > width - fadeOut) env *= (width - px) / fadeOut;
      const y0 = mid - hi * scale * env, y1 = mid - lo * scale * env;
      g.rect(x, y0, 1, Math.max(1, y1 - y0));
    }
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(0, mid, drawW, 1);
  }, [peaks, drawW, visStart, pxPerSec, clip.offset, clip.speed, clip.gainDb, clip.gainPoints, clip.reversed, clip.fadeIn, clip.fadeOut, clip.sourceLength, width, colour]);

  if (!clip.file) return null;
  return <canvas ref={ref} style={{ left: visStart, width: drawW }} />;
}
