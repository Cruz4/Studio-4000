import { useEffect, useRef } from "react";
import { live, onTick } from "./store";
import { meterPos } from "./util";

const peakHold = new Map<string, { v: number; at: number }>();

function readLevel(source: string): [number, number] {
  const t = live.tick;
  if (source === "master") return t.master ?? [-100, -100];
  return t.meters[source] ?? [-100, -100];
}

/** Draws a vertical stereo meter for a track id (or "master") straight from the tick stream. */
export function useMeterCanvas(source: string, vertical = true) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const smooth: [number, number] = [-100, -100];
    let raf = 0;

    const draw = () => {
      raf = 0;
      const c = ref.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const lv = readLevel(source);
      const now = performance.now();
      for (let ch = 0; ch < 2; ch++) {
        smooth[ch] = lv[ch] > smooth[ch] ? lv[ch] : Math.max(lv[ch], smooth[ch] - 1.2);
        const key = source + ch;
        const hold = peakHold.get(key);
        if (!hold || lv[ch] > hold.v || now - hold.at > 1500) peakHold.set(key, { v: lv[ch], at: now });
      }

      const len = vertical ? h : w;
      const thick = vertical ? w : h;
      const bar = (thick - 1) / 2;
      const grad = vertical ? g.createLinearGradient(0, h, 0, 0) : g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "#00d1ff");
      grad.addColorStop(meterPos(-18), "#21e6a5");
      grad.addColorStop(meterPos(-6), "#ffc857");
      grad.addColorStop(meterPos(0), "#ff4d6d");
      grad.addColorStop(1, "#ff4d6d");

      const light = document.documentElement.dataset.theme === "light";
      for (let ch = 0; ch < 2; ch++) {
        const off = ch * (bar + 1);
        g.fillStyle = light ? "rgba(16,20,28,0.4)" : "rgba(255,255,255,0.05)";
        if (vertical) g.fillRect(off, 0, bar, h); else g.fillRect(0, off, w, bar);
        const p = meterPos(smooth[ch]) * len;
        g.fillStyle = grad;
        if (vertical) g.fillRect(off, h - p, bar, p); else g.fillRect(0, off, p, bar);
        const hold = peakHold.get(source + ch)!;
        const hp = meterPos(hold.v) * len;
        if (hp > 1) {
          g.fillStyle = hold.v > 0 ? "#ff4d6d" : "rgba(255,255,255,0.8)";
          if (vertical) g.fillRect(off, h - hp, bar, 1.5); else g.fillRect(hp - 1.5, off, 1.5, bar);
        }
      }
    };

    const unsub = onTick(() => { if (!raf) raf = requestAnimationFrame(draw); });
    draw();
    return () => { unsub(); if (raf) cancelAnimationFrame(raf); };
  }, [source, vertical]);

  return ref;
}
