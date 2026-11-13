/** Short notes for the What's New window. One line each, grouped so it scans. */

export interface WhatsNewGroup {
  title: string;
  color: string;
  items: string[];
}

export const WHATS_NEW: WhatsNewGroup[] = [
  { title: "Keep the takes coming", color: "#ff72df", items: [
    "Right-click Record to arm loop takes, then click Record when you're ready.",
    "The LOOP badge shows the mode is on. Right-click Record to change it or turn it off.",
    "Choose a take count or keep going. Mute earlier takes or layer over them.",
    "Live waveforms stay steady, with driver latency compensation and ASIO support.",
  ] },
  { title: "Find your vocal sound", color: "#7ee7ff", items: [
    "96 complete track chains, including 36 vocal sounds. Preview them in Chains.",
    "12 chains per category for vocals, drum hits, drum buses, bass and instruments.",
    "New vocal processors, 355 effect presets, and factory defaults for every effect.",
  ] },
  { title: "Edit with confidence", color: "#ff92c9", items: [
    "Fuchsia clip selection and a clearer time highlight show exactly what you picked.",
    "Drag anywhere on the ruler to select time, whichever tool is active.",
    "Right-click a selected range to split all tracks at both boundaries.",
    "Alt-drag previews a duplicate and crossfades overlaps immediately.",
  ] },
  { title: "A smoother session", color: "#8cddbc", items: [
    "Markers extend through every track and catch dragged clips magnetically.",
    "History has readable rows, step counts and clear Undo and Redo sections.",
    "Bounce with Effects to New Track prints your sound directly below the source.",
    "Bus meters show the summed signal, including nested buses.",
    "Check mono playback with a Mono toggle on tracks, buses and the master.",
    "The shorter CPU badge stays still, with room around the search button.",
    "Clip gain and fade controls stay behind track headers when you scroll.",
  ] },
  { title: "Make it yours", color: "#f2cf87", items: [
    "Blue Storm is the default dark theme. Studio Sessions remains available in Settings.",
    "Find the original dark look as Dark Night, plus 35 color palettes in Settings.",
    "The top-right switch takes you between Light and Blue Storm.",
    "Light mode keeps its original gray appearance, with slightly darker, bolder text.",
    "EQ type labels stay readable.",
    "Light-mode browser headings use bold, deep purple on the original gray.",
  ] },
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
