import { describe, expect, it } from "vitest";
import { EQ, SCALE_MASKS, bandDb, biquad, biquadDb, compGainDb, freqToX, xToFreq } from "./dsp";

describe("EQ curves", () => {
  it("a +12 dB bell peaks at its centre and is flat far away", () => {
    const k = biquad(EQ.bell, 48000, 1000, 12, 1);
    expect(biquadDb(k, 48000, 1000)).toBeCloseTo(12, 1);
    expect(Math.abs(biquadDb(k, 48000, 50))).toBeLessThan(0.3);
  });

  it("cuts are -3 dB at the corner and stack per slope stage", () => {
    const one = { on: true, type: EQ.lowCut, freq: 100, gain: 0, q: Math.SQRT1_2, stages: 1 };
    expect(bandDb(one, 48000, 100)).toBeCloseTo(-3, 0);
    expect(bandDb({ ...one, stages: 4 }, 48000, 100)).toBeCloseTo(-12, 0);
    expect(bandDb(one, 48000, 25)).toBeLessThan(-20);
  });

  it("shelves reach their gain beyond the corner", () => {
    const hs = { on: true, type: EQ.highShelf, freq: 3000, gain: 6, q: 0.71, stages: 1 };
    expect(bandDb(hs, 48000, 15000)).toBeCloseTo(6, 0);
    expect(Math.abs(bandDb(hs, 48000, 100))).toBeLessThan(0.2);
  });

  it("frequency axis round-trips", () => {
    expect(xToFreq(freqToX(440, 800), 800)).toBeCloseTo(440, 3);
  });
});

describe("compressor curve", () => {
  it("matches a hard-knee 4:1 above threshold", () => {
    expect(compGainDb(-6, -20, 4, 0)).toBeCloseTo(-10.5, 5);
    expect(compGainDb(-30, -20, 4, 0)).toBe(0);
  });

  it("soft knee is continuous at both edges", () => {
    expect(compGainDb(-23, -20, 4, 6)).toBeCloseTo(0, 5);
    expect(compGainDb(-17, -20, 4, 6)).toBeCloseTo(-0.75 * 3, 5);
  });
});

describe("scales", () => {
  it("major has seven notes and the pentatonics five", () => {
    const count = (m: number) => m.toString(2).split("").filter((b) => b === "1").length;
    expect(count(SCALE_MASKS[1])).toBe(7);
    expect(count(SCALE_MASKS[4])).toBe(5);
    expect(count(SCALE_MASKS[5])).toBe(5);
  });
});
