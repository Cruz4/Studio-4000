// Modified for Studio 4000 recording previews.
import { describe, expect, it } from "vitest";
import { recordingPeak, recordingRange, type RecordingPreview } from "./recording";

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
