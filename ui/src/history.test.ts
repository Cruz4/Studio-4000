import { describe, expect, it } from "vitest";
import { historyEntries } from "./history";

describe("history transactions", () => {
  it("labels unnamed entries without skipping real undo steps", () => {
    expect(historyEntries(["Effects on", "", "  \n ", "New track"], "undo")).toEqual([
      { name: "Effects on", steps: 1 }, { name: "Edit", steps: 2 },
      { name: "Edit", steps: 3 }, { name: "New track", steps: 4 },
    ]);
  });
  it("keeps redo entries nearest first and maps each to its exact target", () => {
    expect(historyEntries(["Move clip", "", "Rename track"], "redo")).toEqual([
      { name: "Move clip", steps: -1 }, { name: "Edit", steps: -2 }, { name: "Rename track", steps: -3 },
    ]);
  });
  it("keeps repeated actions distinct and normalizes multiline labels", () => {
    expect(historyEntries(["New track", "New track", "  Clip\n  gain  "], "undo")).toEqual([
      { name: "New track", steps: 1 }, { name: "New track", steps: 2 }, { name: "Clip gain", steps: 3 },
    ]);
    expect(historyEntries([], "undo")).toEqual([]);
  });
});
