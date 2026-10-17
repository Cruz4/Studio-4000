import { describe, expect, it } from "vitest";
import { BAND_COLORS, COLORS } from "./core";
import { knobLook } from "./knobLook";

describe("knob colors stay with the parameter", () => {
  it("keeps Pitch Correction colors no matter which view asks", () => {
    expect(knobLook("s4000tune", "speed")).toEqual({ color: COLORS.cyan, label: "Retune speed" });
    expect(knobLook("s4000tune", "amount")).toEqual({ color: COLORS.violet2, label: "Correction amount" });
    expect(knobLook("s4000tune", "tolerance").color).toBe(COLORS.amber);
    expect(knobLook("s4000tune", "mix")).toEqual({ color: COLORS.green, label: "Dry / wet" });
  });

  it("does not paint every dry/wet the same", () => {
    expect(knobLook("s4000comp", "mix").color).toBe(COLORS.cyan);
    expect(knobLook("s4000crusher", "mix").color).toBe(COLORS.violet2);
    expect(knobLook("s4000delay", "mix").color).toBe(COLORS.green);
  });

  it("colors an EQ band the same in the card and the editor", () => {
    expect(knobLook("s4000eq", "b2gain").color).toBe(BAND_COLORS[1]);
    expect(knobLook("s4000eq", "b4freq").color).toBe(BAND_COLORS[3]);
    expect(knobLook("s4000eq", "output").color).toBe(COLORS.violet2);
    expect(knobLook("4bandEq", "Low-pass gain").color).toBe(BAND_COLORS[0]);
    expect(knobLook("4bandEq", "High-pass gain").color).toBe(BAND_COLORS[3]);
  });

  it("gives an unknown plug-in the same color for a parameter in every view", () => {
    const a = knobLook("VST3:SomeVendor:SomePlugin", "mix");
    const b = knobLook("VST3:SomeVendor:SomePlugin", "mix");
    expect(a.color).toBe(b.color);
    expect(BAND_COLORS).toContain(a.color);
    expect(knobLook("VST3:SomeVendor:SomePlugin", "drive").color).not.toBe(a.color);
  });
});
