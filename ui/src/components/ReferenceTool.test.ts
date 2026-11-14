import { describe, expect, it } from "vitest";
import { wavBlob } from "./ReferenceTool";

describe("reference recording", () => {
  it("preserves the shared stream as stereo 32-bit float WAV", async () => {
    const blob = wavBlob([[new Float32Array([.25, -.5]), new Float32Array([.75, -1])]], 48000);
    const view = new DataView(await blob.arrayBuffer());
    expect(view.getUint16(20, true)).toBe(3);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(32);
    expect(view.getFloat32(44, true)).toBeCloseTo(.25);
    expect(view.getFloat32(48, true)).toBeCloseTo(.75);
  });
});
