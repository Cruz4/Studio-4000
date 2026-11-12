import { describe, expect, it } from "vitest";
import { CHAIN_CATEGORIES, TRACK_CHAINS } from "./trackChains";

describe("complete track chains", () => {
  it("includes twelve useful chains in every category and 36 vocal chains", () => {
    expect(CHAIN_CATEGORIES).toHaveLength(8);
    expect(TRACK_CHAINS).toHaveLength(96);
    expect(new Set(TRACK_CHAINS.map((p) => p.id)).size).toBe(96);
    for (const category of CHAIN_CATEGORIES) expect(TRACK_CHAINS.filter((p) => p.category === category)).toHaveLength(12);
    expect(TRACK_CHAINS.filter((p) => p.category.startsWith("Vocals"))).toHaveLength(36);
  });
  it("uses finite real values and multiple processors in every chain", () => {
    for (const chain of TRACK_CHAINS) {
      expect(chain.description.length).toBeGreaterThan(30);
      expect(chain.plugins.length).toBeGreaterThanOrEqual(3);
      expect(chain.plugins.length).toBeLessThanOrEqual(12);
      for (const plugin of chain.plugins) {
        expect(Object.values(plugin.values).length).toBeGreaterThan(0);
        expect(Object.values(plugin.values).every((n) => typeof n === "number" && Number.isFinite(n))).toBe(true);
      }
    }
  });
});
