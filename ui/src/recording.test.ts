// Modified for Studio 4000 recording previews.
import { describe, expect, it } from "vitest";
import { recordingPeak, recordingRange, mergeRecording, type RecordingPreview } from "./recording";

describe("live recording waveform", () => {
  const preview: RecordingPreview = {
    trackId: "vocal", file: "open.wav", start: 1.25, length: 2,
    channels: 2, binsPerSecond: 1, data: [-12, 20, -45, 60, -30, 40, -70, 90],
  };
  it("keeps left and right captured peaks separate", () => {
    expect(recordingPeak(preview, 0, 1, 0)).toEqual([-12, 20]);
    expect(recordingPeak(preview, 0, 2, 1)).toEqual([-70, 90]);
  });
  it("does not invent data past the recorded audio", () => {
    expect(recordingPeak(preview, 2, 3, 0)).toEqual([0, 0]);
  });
  it("preserves the actual punch-in time", () => {
    expect(recordingRange(preview, [0, 8], false)).toEqual({ start: 1.25, length: 2, offset: 0 });
  });
  it("draws just the current pass after a partial first loop", () => {
    expect(recordingRange({ start: 3, length: 6 }, [2, 6], true)).toEqual({ start: 2, length: 3, offset: 3 });
    expect(recordingRange({ start: 3, length: 9 }, [2, 6], true)).toEqual({ start: 2, length: 2, offset: 7 });
  });
  it("keeps a complete pass visible at the exact loop boundary", () => {
    expect(recordingRange({ start: 2, length: 8 }, [2, 6], true)).toEqual({ start: 2, length: 4, offset: 4 });
  });
  it("ignores an empty loop range", () => {
    expect(recordingRange(preview, [0, 0], true)).toEqual({ start: 1.25, length: 2, offset: 0 });
  });
});

describe("fixed recording bins", () => {
  const chunk = (startBin: number, data: number[], length = 5): RecordingPreview => ({ trackId: "v", file: "v.wav", start: 0, length, channels: 1, binsPerSecond: 46.875, startBin, data });
  it("keeps old peaks unchanged while the tail grows", () => {
    const first = mergeRecording(undefined, chunk(0, [-50, 70, -20, 30]));
    const next = mergeRecording(first, chunk(1, [-25, 35, -5, 10], 6));
    expect(next.data.slice(0, 2)).toEqual([-50, 70]);
    expect(recordingPeak(next, 0, 1 / next.binsPerSecond, 0)).toEqual([-50, 70]);
    expect(next.receivedBins).toBe(3);
  });
  it("backfills gaps without discarding newer bins", () => {
    let take = mergeRecording(undefined, chunk(2, [-30, 50]));
    expect(take.receivedBins).toBe(0);
    take = mergeRecording(take, chunk(0, [-10, 20, -15, 25]));
    expect(take.receivedBins).toBe(2);
    expect(take.data).toEqual([-10, 20, -15, 25, -30, 50]);
    take = mergeRecording(take, chunk(2, [-30, 50]));
    expect(take.receivedBins).toBe(3);
  });
});
