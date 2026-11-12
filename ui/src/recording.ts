// Modified for Studio 4000: recording previews come from captured samples, before the WAV is closed.
export interface RecordingPreview {
  trackId: string;
  file: string;
  start: number;
  length: number;
  channels: number;
  binsPerSecond: number;
  data: number[];
  startBin?: number;
  receivedBins?: number;
}

/** Only the current pass is shown when recording into looped takes. */
export function recordingRange(preview: Pick<RecordingPreview, "start" | "length">, loop: [number, number], looping: boolean) {
  const length = Math.max(0, preview.length);
  const loopLength = loop[1] - loop[0];
  const first = loop[1] - preview.start;
  if (!looping || loopLength <= 0.01 || first <= 0 || length <= first)
    return { start: preview.start, length, offset: 0 };
  const elapsed = length - first;
  const pass = Math.ceil(elapsed / loopLength) - 1;
  const offset = first + Math.max(0, pass) * loopLength;
  return { start: loop[0], length: length - offset, offset };
}

export function recordingPeak(preview: RecordingPreview, start: number, end: number, channel: number): [number, number] {
  const stride = preview.channels * 2;
  const bins = Math.floor(preview.data.length / stride);
  const from = Math.max(0, Math.floor(start * preview.binsPerSecond));
  const to = Math.min(bins, Math.max(from + 1, Math.ceil(end * preview.binsPerSecond)));
  let lo = 0, hi = 0;
  for (let b = from; b < to; b++) {
    lo = Math.min(lo, preview.data[b * stride + channel * 2] ?? 0);
    hi = Math.max(hi, preview.data[b * stride + channel * 2 + 1] ?? 0);
  }
  return [lo, hi];
}

/** Accumulate fixed bins without copying a long take every tick. */
export function mergeRecording(previous: RecordingPreview | undefined, update: RecordingPreview): RecordingPreview {
  const data = previous?.data ?? [];
  const from = update.startBin ?? 0, stride = update.channels * 2;
  for (let i = 0; i < update.data.length; i++) data[from * stride + i] = update.data[i];
  const end = from + Math.floor(update.data.length / stride);
  let receivedBins = previous?.receivedBins ?? 0;
  if (from <= receivedBins) receivedBins = Math.max(receivedBins, end);
  return { ...update, length: Math.max(previous?.length ?? 0, update.length), startBin: 0, receivedBins, data };
}
