import type { MenuItem } from "./components/ContextMenu";
import { act, useStore } from "./store";

export function rangeSelectionItems(time?: number): MenuItem[] {
  const state = useStore.getState();
  const range = state.project?.loop;
  if (!range || range[1] - range[0] < .05 || time != null && (time < range[0] || time > range[1])) return [];
  const split = (trackIds?: string[]) => act("batch.run", { label: "Split at selection boundaries", calls: [range[1], range[0]].map((time) => ({ method: "clip.splitAt", params: { time, ...(trackIds ? { trackIds } : {}) } })) });
  return [
    { label: "Split all tracks at selection boundaries", icon: "scissors", run: () => split() },
    ...(state.selectedTracks.length ? [{ label: "Split selected tracks at selection boundaries", icon: "scissors", run: () => split(state.selectedTracks) }] : []),
  ];
}
