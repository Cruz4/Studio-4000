/** Short notes for the What's New window. One line each, grouped so it scans. */

export interface WhatsNewGroup {
  title: string;
  color: string;
  items: string[];
}

export const WHATS_NEW: WhatsNewGroup[] = [
  {
    title: "Clips",
    color: "#ffc857",
    items: [
      "Double-click any clip and the Editor opens.",
      "Hover either end and the pointer becomes trim arrows.",
      "IN and OUT boxes fade the clip, here and in the Editor.",
      "Clips that overlap crossfade. Drag the boxes to reshape it.",
      "A yellow gain line and a blue pan line, on the clip and in the Editor.",
      "The track name row has a pan bar. Double-click for center.",
      "Snap on: a clip catches the next clip's start or end, and any marker.",
      "Ctrl locks the time on a vertical drag. Alt-drag drops a copy.",
      "Drag either end of the purple bar to change the loop.",
      "Delete clears that bar if you moved it last. Right-click it too.",
    ],
  },
  {
    title: "Tracks",
    color: "#7ee7ff",
    items: [
      "A new audio track or bus can be stereo or mono.",
      "Track effects and clip effects each have their own dry/wet.",
      "Drag the bottom-left of a clip to change its volume.",
    ],
  },
  {
    title: "Export",
    color: "#c4b5ff",
    items: [
      "Export asks where to save, then writes the file.",
      "Choose WAV, MP3, or MP3 and WAV together.",
    ],
  },
  {
    title: "Sessions",
    color: "#ff8ab8",
    items: [
      "People hosts a session and hands you one code.",
      "Paste the code to join from any network.",
      "End closes it for everyone. Leave returns to join.",
    ],
  },
  {
    title: "Effects",
    color: "#3ee0a0",
    items: [
      "Parametric EQ shows the live spectrum while audio plays.",
      "Classic EQ is Tracktion's 4-band. It draws the curve.",
      "Few knobs, the full editor, or its own window.",
      "Save a chain and load it on a track or a clip.",
    ],
  },
  {
    title: "Phone",
    color: "#9ad7ff",
    items: [
      "The public page fits a phone, with every control in reach.",
      "The start page scrolls, and the cards take a tap.",
      "Sound and recording still need the Windows app.",
    ],
  },
];

const SEEN_KEY = "studio4000-seen-notes";

/** `v` plus a short id. A published build uses its id. A local copy uses its version. */
export function versionLabel(info?: { version?: string; commit?: string } | null): string {
  const id = (info?.commit ?? "").trim().toLowerCase();
  if (/^[0-9a-f]{7,40}$/.test(id)) return `v${id.slice(0, 7)}`;
  const version = (info?.version ?? "").trim();
  if (!version) return "";
  return /^v/i.test(version) ? version : `v${version}`;
}

export function seenNotes(label: string): boolean {
  if (!label) return true;
  try { return localStorage.getItem(SEEN_KEY) === label; } catch { return false; }
}

export function rememberNotes(label: string) {
  if (!label) return;
  try { localStorage.setItem(SEEN_KEY, label); } catch { /* private mode */ }
}
