export interface HistoryEntry { name: string; steps: number }

/** Keep every engine transaction, including unnamed ones, so jump distances remain exact. */
export function historyEntries(names: readonly string[], direction: "undo" | "redo"): HistoryEntry[] {
  return names.map((name, i) => ({
    name: name.replace(/\s+/g, " ").trim() || "Edit",
    steps: (i + 1) * (direction === "undo" ? 1 : -1),
  }));
}
