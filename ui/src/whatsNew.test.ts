import { describe, expect, it } from "vitest";
import { versionLabel, WHATS_NEW } from "./whatsNew";

describe("version label", () => {
  it("uses v and a short id", () => {
    expect(versionLabel({ version: "0.1.0", commit: "64159d40321c924f1d07f4ed255a0bdf317839f7" })).toBe("v64159d4");
    expect(versionLabel({ version: "0.1.0", commit: "" })).toBe("v0.1.0");
    expect(versionLabel({ version: "0.1.0-mock", commit: "local" })).toBe("v0.1.0-mock");
    expect(versionLabel(null)).toBe("");
  });

  it("keeps the notes short and grouped", () => {
    expect(WHATS_NEW.map((g) => g.title)).toEqual(["Sessions", "Effects", "Arrange", "Look", "Help"]);
    const lines = WHATS_NEW.flatMap((g) => g.items);
    expect(lines.length).toBeGreaterThanOrEqual(16);
    expect(lines.every((line) => line.length < 90)).toBe(true);
    expect(JSON.stringify(WHATS_NEW).toLowerCase().includes("commit")).toBe(false);
  });
});
