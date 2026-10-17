import { askText } from "./components/Ask";
import { openMenu, type MenuItem } from "./components/ContextMenu";
import { rpc } from "./bridge";
import { addMidiClip, addTrack, importAudio, vocalChain } from "./commands";
import { act, useStore } from "./store";
import type { Track } from "./types";

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
export function trackMenu(track: Track, chains: { name: string }[] = []): MenuItem[] {
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
    { label: "Load insert chain…", icon: "layers", disabled: chains.length === 0, title: chains.length ? "Choose a saved chain below" : "Save a chain first, then it shows up here" },
    ...chains.map((c) => ({
      label: `Load “${c.name}”`,
      icon: "layers" as const,
      title: "Adds this saved effect chain to the track",
      run: () => act("chain.load", { trackId: track.id, name: c.name }),
    })),
    { separator: true },
    { label: "Delete track", icon: "trash", danger: true, run: () => act("track.remove", { id: track.id }) },
  ];
}

/** Opens the track menu, with any saved effect chains listed so they can be loaded onto this track. */
export function openTrackMenu(e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void }, track: Track) {
  e.preventDefault();
  e.stopPropagation();
  const at = { clientX: e.clientX, clientY: e.clientY, preventDefault: () => {}, stopPropagation: () => {} };
  void rpc<{ name: string }[]>("chain.list").then((chains) => {
    openMenu(at, trackMenu(track, chains ?? []));
  }).catch(() => openMenu(at, trackMenu(track)));
}
