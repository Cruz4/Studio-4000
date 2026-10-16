import type { Devices } from "./store";
import type { Project, Track } from "./types";

export interface Choice { value: string; label: string; group?: string }

const ALL_MIDI = "All MIDI Ins";

/** Inputs a track can record from: audio inputs for audio tracks, MIDI devices for instrument tracks. */
export function inputChoices(track: Track, devices: Devices | null): Choice[] {
  const list: Choice[] = track.kind === "instrument"
    ? (devices?.midiInputs ?? []).map((m) => ({ value: m.name, label: m.name === ALL_MIDI ? "All keyboards + typing" : m.name, group: m.virtual ? "Virtual" : "MIDI devices" }))
    : (devices?.audioInputs ?? []).map((n) => ({ value: n, label: n, group: "Audio inputs" }));
  if (track.input && !list.some((c) => c.value === track.input)) list.push({ value: track.input, label: track.input });
  return [{ value: "", label: "No input" }, ...list];
}

/** Where a track's signal goes: the master bus, a group, a hardware output pair, or nowhere. */
export function outputChoices(track: Track, project: Project, devices: Devices | null): Choice[] {
  return [
    { value: "master", label: "Master" },
    ...project.tracks.filter((t) => t.kind === "group" && t.id !== track.id).map((t) => ({ value: t.id, label: t.name, group: "Groups" })),
    ...(devices?.outputs ?? []).map((o) => ({ value: `device:${o}`, label: o, group: "Hardware outputs" })),
    { value: "none", label: "None" },
  ];
}

export function inputLabel(track: Track) {
  if (!track.input) return "No input";
  return track.input === ALL_MIDI ? "All keyboards" : track.input;
}

export function outputLabel(track: Track, project: Project) {
  const out = track.output ?? "master";
  if (out === "master") return "Master";
  if (out === "none") return "No output";
  if (out.startsWith("device:")) return out.slice(7);
  return project.tracks.find((t) => t.id === out)?.name ?? "Master";
}
