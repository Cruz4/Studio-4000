import { describe, expect, it } from "vitest";
import type { Param } from "../../types";
import { parameterFromNorm, parameterToNorm } from "./core";

const frequency: Param = { id: "freq", name: "Frequency", value: 1000, norm: .5, text: "1000 Hz", min: 20, max: 20000, centre: 1000, automated: false };

describe("skewed effect controls", () => {
  it("keeps a logarithmic frequency knob aligned with an EQ node", () => {
    expect(parameterToNorm(frequency, 1000)).toBeCloseTo(.5, 8);
    const points = [20, 80, 250, 1000, 5000, 12000, 20000];
    const norms = points.map((value) => parameterToNorm(frequency, value));
    expect(norms).toEqual([...norms].sort((a, b) => a - b));
    points.forEach((value) => expect(parameterFromNorm(frequency, parameterToNorm(frequency, value))).toBeCloseTo(value, 5));
  });
});
