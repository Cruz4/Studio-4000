import { askText } from "./components/Ask";
import { addMidiClip, addTrack, importAudio, vocalChain } from "./commands";
import { act, useStore } from "./store";
import type { Track } from "./types";
import type { MenuItem } from "./components/ContextMenu";

const CHAIN_TIP = "Saves this track's effects as a chain you can drop onto another track.";

/** New tracks land directly under the one this menu was opened on. */
export function createTrackItems(afterId?: string): MenuItem[] {
  const place = afterId ? { afterId } : {};
  return [
    { label: "Create New Audio Track", icon: "mic", run: () => addTrack("audio", place) },
    { label: "Create New Instrument Track", icon: "piano", run: () => addTrack("instrument", place) },
    { label: "Create New Bus", icon: "layers", run: () => addTrack("group", place) },
    { label: "Create New FX Return", icon: "send", run: () => addTrack("return", place) },
  ];
}

export function toggleAutomation(track: Track) {
  useStore.setState((s) => ({ automationOpen: { ...s.automationOpen, [track.id]: s.automationOpen[track.id] ? null : `${track.volumePluginId}:volume` } }));
}

/** The track menu shared by the arrange headers and the mixer strips. */
export function trackMenu(track: Track): MenuItem[] {
  const autoOpen = !!useStore.getState().automationOpen[track.id];
  return [
    { label: "Rename", icon: "file", run: () => (document.querySelector(`[data-name="${track.id}"]`) as HTMLInputElement | null)?.focus() },
    { colours: { value: track.colour, run: (c) => act("track.set", { id: track.id, colour: c }) } },
    { separator: true },
    ...createTrackItems(track.id),
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
    { label: "Save insert chain…", icon: "layers", title: CHAIN_TIP, run: () => {
      void askText({ title: "Save insert chain", hint: CHAIN_TIP, value: `${track.name} chain`, ok: "Save" })
        .then((n) => { if (n) act("chain.save", { trackId: track.id, name: n }); });
    } },
    { separator: true },
    { label: "Role: vocal", run: () => act("track.set", { id: track.id, role: "vocal" }) },
    { label: "Role: dialogue", run: () => act("track.set", { id: track.id, role: "dialogue" }) },
    { label: "Role: drums / bass / music", run: () => {
      void askText({ title: "Track role", hint: "Used by Smart Mix. Drums, bass, or music.", value: "music", ok: "Set" })
        .then((r) => { if (r) act("track.set", { id: track.id, role: r }); });
    } },
    { separator: true },
    { label: "Delete track", icon: "trash", danger: true, run: () => act("track.remove", { id: track.id }) },
  ];
}
