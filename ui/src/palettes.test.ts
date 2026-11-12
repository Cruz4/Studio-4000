import { describe, it, expect } from "vitest";
import { PALETTES, paletteTokens, contrast } from "./palettes";
describe("supplied DAW palettes", () => {
  it("contains all 35 distinct themes and valid source colours", () => {
    expect(PALETTES).toHaveLength(35); expect(new Set(PALETTES.map((p) => p.id)).size).toBe(35);
    for (const p of PALETTES) for (const c of [p.primary, p.secondary, p.accent]) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it("Studio Sessions changes only the effects-heading colour", () => {
    const studio = PALETTES.find((p) => p.id === "studio-sessions")!;
    const shine = PALETTES.find((p) => p.id === "technological-shine")!;
    const { ["--effects-heading"]: heading, ...tokens } = paletteTokens(studio);
    const { ["--effects-heading"]: originalHeading, ...originalTokens } = paletteTokens({ ...studio, effectsHeading: undefined });
    expect(tokens).toEqual(originalTokens);
    expect(heading).toBe(shine.accent);
    expect(heading).toBe("#FF00FF");
    expect(heading).not.toBe(originalHeading);
    expect(PALETTES.find((p) => p.id === "plotting")!.name).toBe("Plotting");
  });
  for (const p of PALETTES) it(p.name + " has readable text and button ink", () => {
    const t = paletteTokens(p);
    for (const bg of ["--bg", "--bg1", "--bg2", "--bg3", "--bg4"])
      for (const ink of ["--text", "--dim", "--faint", "--violet", "--violet2", "--cyan"])
        expect(contrast(t[bg], t[ink])).toBeGreaterThanOrEqual(4.5);
    for (const role of ["primary", "secondary", "accent"])
      expect(contrast(t["--" + role + "-fill"], t["--" + role + "-ink"])).toBeGreaterThanOrEqual(4.5);
  });
});
