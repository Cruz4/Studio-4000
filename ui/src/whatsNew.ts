/** Short notes for the What's New window. One line each, grouped so it scans. */

export interface WhatsNewGroup {
  title: string;
  color: string;
  items: string[];
}

export const WHATS_NEW: WhatsNewGroup[] = [
  {
    title: "Sessions",
    color: "#00d1ff",
    items: [
      "People button hosts. One code.",
      "Paste the code. Join from any network.",
      "End closes it. Leave goes back to join.",
    ],
  },
  {
    title: "Effects",
    color: "#21e6a5",
    items: [
      "Few knobs, the full editor, or a window.",
      "Green power light on the card and the window.",
      "Each knob keeps its color in every view.",
      "Select several to copy, paste, delete, or reorder.",
      "Drag a name onto a track to copy it.",
      "Save a chain. Load it on a track or a clip.",
      "Clip effects sit beside the track chain.",
    ],
  },
  {
    title: "Arrange",
    color: "#ffc857",
    items: [
      "Gain line: click, drag, double-click to remove.",
      "Ruler clock. Marks follow your zoom.",
      "MIDI notes stay in the clip while it moves.",
      "Dragged clips match the track height.",
      "New clips have no automatic fade.",
      "Old 5 ms edge fades clear on open.",
    ],
  },
  {
    title: "Look",
    color: "#a08bff",
    items: [
      "Darker silver, with near-black section lines.",
      "Level bars match dark, in a color that shows.",
    ],
  },
  {
    title: "Help",
    color: "#ff6b9a",
    items: [
      "Search How Studio 4000 works.",
    ],
  },
  {
    title: "Phone",
    color: "#4dd4ff",
    items: [
      "The site fits a phone. Nothing is clipped off the edge.",
      "Menus, transport, tracks, mixer, and effects stay in reach.",
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
