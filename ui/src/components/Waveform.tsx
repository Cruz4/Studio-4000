import { useEffect, useRef, useState } from "react";
import type { Clip } from "../types";
import { cachedPeaks, loadPeaks, type Peaks } from "../util";

/** Draws the part of an audio clip that is visible in the scroll viewport. */
export function Waveform({ clip, pxPerSec, colour, viewLeft, viewWidth, clipLeft }: {
  clip: Clip; pxPerSec: number; colour: string; viewLeft: number; viewWidth: number; clipLeft: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = `${clip.file}#${Math.round((clip.sourceLength ?? 0) * 10)}`;
  const [peaks, setPeaks] = useState<Peaks | null>(() => (clip.file ? cachedPeaks(key) ?? null : null));

  useEffect(() => {
    if (!clip.file) return;
    let alive = true;
    loadPeaks(clip.file, key).then((p) => alive && setPeaks(p));
    return () => { alive = false; };
  }, [clip.file, key]);

  const width = (clip.end - clip.start) * pxPerSec;
  const visStart = Math.max(0, viewLeft - clipLeft - 200);
  const visEnd = Math.min(width, viewLeft + viewWidth - clipLeft + 200);
  const drawW = Math.max(0, Math.ceil(visEnd - visStart));

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
    const mid = h / 2;
    const scale = (h / 2 - 1) / 127 * Math.min(gain, 4);
    const bins = peaks.data.length / 2;
    const speed = clip.speed || 1;
    const fadeIn = (clip.fadeIn ?? 0) * pxPerSec, fadeOut = (clip.fadeOut ?? 0) * pxPerSec;

    g.fillStyle = colour;
    g.beginPath();
    for (let x = 0; x < drawW; x++) {
      const px = visStart + x;
      let t0 = clip.offset + (px / pxPerSec) * speed;
      let t1 = clip.offset + ((px + 1) / pxPerSec) * speed;
      if (clip.reversed && clip.sourceLength) { const a = clip.sourceLength - t1, b = clip.sourceLength - t0; t0 = a; t1 = b; }
      let b0 = Math.floor(t0 * peaks.binsPerSecond), b1 = Math.max(b0 + 1, Math.floor(t1 * peaks.binsPerSecond));
      if (b0 >= bins || b1 <= 0) continue;
      b0 = Math.max(0, b0); b1 = Math.min(bins, b1);
      let lo = 0, hi = 0;
      for (let b = b0; b < b1; b++) {
        const l = peaks.data[b * 2], u = peaks.data[b * 2 + 1];
        if (l < lo) lo = l;
        if (u > hi) hi = u;
      }
      let env = 1;
      if (fadeIn > 0 && px < fadeIn) env = px / fadeIn;
      if (fadeOut > 0 && px > width - fadeOut) env = Math.min(env, (width - px) / fadeOut);
      const y0 = mid - hi * scale * env, y1 = mid - lo * scale * env;
      g.rect(x, y0, 1, Math.max(1, y1 - y0));
    }
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(0, mid, drawW, 1);
  }, [peaks, drawW, visStart, pxPerSec, clip.offset, clip.speed, clip.gainDb, clip.reversed, clip.fadeIn, clip.fadeOut, clip.sourceLength, width, colour]);

  if (!clip.file) return null;
  return <canvas ref={ref} style={{ left: visStart, width: drawW }} />;
}
