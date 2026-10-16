import { addMidiClip, addTrack, importAudio, vocalChain } from "./commands";
import { act, useStore } from "./store";
import type { Track } from "./types";
import type { MenuItem } from "./components/ContextMenu";

export function toggleAutomation(track: Track) {
  useStore.setState((s) => ({ automationOpen: { ...s.automationOpen, [track.id]: s.automationOpen[track.id] ? null : `${track.volumePluginId}:volume` } }));
}

/** The track menu shared by the arrange headers and the mixer strips. */
export function trackMenu(track: Track): MenuItem[] {
  const list = useStore.getState().project?.tracks ?? [];
  const at = list.findIndex((t) => t.id === track.id);
  const below = { afterId: track.id };
  const above = at <= 0 ? { beforeId: track.id } : { afterId: list[at - 1].id };
  const autoOpen = !!useStore.getState().automationOpen[track.id];
  return [
    { label: "Rename", icon: "file", run: () => (document.querySelector(`[data-name="${track.id}"]`) as HTMLInputElement | null)?.focus() },
    { colours: { value: track.colour, run: (c) => act("track.set", { id: track.id, colour: c }) } },
    { separator: true },
    { label: "New audio track below", icon: "mic", run: () => addTrack("audio", below) },
    { label: "New instrument track below", icon: "piano", run: () => addTrack("instrument", below) },
    { label: "New bus below", icon: "layers", run: () => addTrack("group", below) },
    { label: "New FX return below", icon: "send", run: () => addTrack("return", below) },
    { label: "New audio track above", icon: "mic", run: () => addTrack("audio", above) },
    { label: "New instrument track above", icon: "piano", run: () => addTrack("instrument", above) },
    { label: "New bus above", icon: "layers", run: () => addTrack("group", above) },
    { label: "New FX return above", icon: "send", run: () => addTrack("return", above) },
    { separator: true },
    ...(track.kind === "audio" ? [{ label: "Import audio here…", icon: "folder", run: () => importAudio(track.id) }] : []),
    ...(track.kind === "instrument" ? [{ label: "New MIDI clip at playhead", icon: "piano", run: () => addMidiClip(track.id) }] : []),
    { label: "Duplicate track", icon: "copy", run: () => act("track.duplicate", { id: track.id }) },
    { label: autoOpen ? "Hide automation" : "Show automation", icon: "automation", run: () => toggleAutomation(track) },
    ...(track.kind === "audio" ? [
      { label: "Vocal chain: modern pop", icon: "wand", run: () => vocalChain(track.id, "pop") },
      { label: "Vocal chain: warm", icon: "wand", run: () => vocalChain(track.id, "warm") },
      { label: "Voice chain: podcast", icon: "wand", run: () => vocalChain(track.id, "podcast") },
    ] : []),
    { label: "Save insert chain…", icon: "layers", run: () => { const n = window.prompt("Chain name", `${track.name} chain`); if (n) act("chain.save", { trackId: track.id, name: n }); } },
    { separator: true },
    { label: "Role: vocal", run: () => act("track.set", { id: track.id, role: "vocal" }) },
    { label: "Role: dialogue", run: () => act("track.set", { id: track.id, role: "dialogue" }) },
    { label: "Role: drums / bass / music", run: () => {
      const r = window.prompt("Role (drums, bass, music)", "music");
      if (r) act("track.set", { id: track.id, role: r });
    } },
    { separator: true },
    { label: "Delete track", icon: "trash", danger: true, run: () => act("track.remove", { id: track.id }) },
  ];
}
