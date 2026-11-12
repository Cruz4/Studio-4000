// Modified for Studio 4000: display real captured waveform data during a take.
import { useLayoutEffect, useRef } from "react";
import type { Project, Track } from "../types";
import { recordingPeak, recordingRange, type RecordingPreview } from "../recording";

export function RecordingClip({ preview, track, project, pps, view }: {
  preview: RecordingPreview; track: Track; project: Project; pps: number; view: { left: number; width: number };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const range = recordingRange(preview, project.loop, project.looping);
  const left = range.start * pps, width = Math.max(2, range.length * pps);
  const visibleStart = Math.floor(Math.max(0, view.left - left));
  const drawWidth = Math.ceil(view.width + 2);
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c || drawWidth <= 0) return;
    const dpr = window.devicePixelRatio || 1, height = c.clientHeight || 40;
    if (c.width !== Math.ceil(drawWidth * dpr)) c.width = Math.ceil(drawWidth * dpr);
    if (c.height !== Math.ceil(height * dpr)) c.height = Math.ceil(height * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, drawWidth, height);
    const channels = track.channels === 1 ? 1 : Math.min(2, preview.channels);
    const band = height / Math.max(1, channels);
    g.fillStyle = "#ffe1e8";
    for (let ch = 0; ch < channels; ch++) {
      const middle = (ch + 0.5) * band, scale = (band / 2 - 1) / 127;
      for (let x = 0; x < drawWidth; x++) {
        const start = range.offset + (visibleStart + x) / pps;
        const [lo, hi] = recordingPeak(preview, start, start + 1 / pps, ch);
        g.fillRect(x, middle - hi * scale, 1, Math.max(1, (hi - lo) * scale));
      }
    }
  }, [preview, range.offset, drawWidth, visibleStart, pps, track.channels]);
  if (left > view.left + view.width || left + width < view.left || range.length <= 0) return null;
  return <div className="clip recording-preview" aria-label={`Recording ${track.name}`}
    style={{ left, width, pointerEvents: "none", background: "rgba(172,32,61,.5)", border: "1px solid #ff4d6d", zIndex: 3 }}>
    <div className="clip-label" style={{ background: "rgba(130,15,40,.8)" }}>● Recording</div>
    <canvas ref={canvas} style={{ left: visibleStart, width: drawWidth }} />
  </div>;
}
