// Arrange-view track heights: one shared default plus per-track overrides, remembered between sessions.
import { create } from "zustand";
import { clamp } from "./util";

export const TRACK_H_MIN = 36;
export const TRACK_H_MAX = 360;
export const TRACK_H_DEFAULT = 104;
const KEY = "s4.trackHeights";

interface Heights { base: number; per: Record<string, number> }

function load(): Heights {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v.base === "number" && v.per && typeof v.per === "object") return { base: clamp(v.base, TRACK_H_MIN, TRACK_H_MAX), per: v.per };
  } catch { /* fall through to defaults */ }
  return { base: TRACK_H_DEFAULT, per: {} };
}

export const useTrackHeights = create<Heights>(() => load());

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useTrackHeights.subscribe((s) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or unavailable */ } }, 250);
});

export const heightOf = (s: Heights, id: string) => s.per[id] ?? s.base;

export function setTrackHeight(id: string, h: number) {
  useTrackHeights.setState((s) => ({ per: { ...s.per, [id]: Math.round(clamp(h, TRACK_H_MIN, TRACK_H_MAX)) } }));
}

export function resetTrackHeight(id: string) {
  useTrackHeights.setState((s) => { const per = { ...s.per }; delete per[id]; return { per }; });
}

/** Grows or shrinks every track by the same amount, keeping the differences between them. */
export function resizeAllTracks(delta: number) {
  useTrackHeights.setState((s) => {
    const per: Record<string, number> = {};
    for (const [id, h] of Object.entries(s.per)) per[id] = Math.round(clamp(h + delta, TRACK_H_MIN, TRACK_H_MAX));
    return { base: Math.round(clamp(s.base + delta, TRACK_H_MIN, TRACK_H_MAX)), per };
  });
}

/** Sets every track to one height (Shift-dragging a divider). */
export function setAllTrackHeights(h: number) {
  useTrackHeights.setState({ base: Math.round(clamp(h, TRACK_H_MIN, TRACK_H_MAX)), per: {} });
}

/** Width of the track-info column. Dragging its right edge changes every header at once. */
export const HEADER_W_MIN = 176;
export const HEADER_W_MAX = 520;
export const HEADER_W_DEFAULT = 232;
const HEADER_KEY = "s4.headerW";

function loadHeaderW() {
  try {
    const raw = localStorage.getItem(HEADER_KEY);
    const n = Number(raw);
    return raw != null && Number.isFinite(n) ? clamp(n, HEADER_W_MIN, HEADER_W_MAX) : HEADER_W_DEFAULT;
  } catch { return HEADER_W_DEFAULT; }
}

export const useHeaderWidth = create<{ w: number }>(() => ({ w: loadHeaderW() }));

export function setHeaderWidth(w: number) {
  useHeaderWidth.setState({ w: clamp(Math.round(w), HEADER_W_MIN, HEADER_W_MAX) });
}

useHeaderWidth.subscribe((s) => {
  try { localStorage.setItem(HEADER_KEY, String(s.w)); } catch { /* storage full or unavailable */ }
});
