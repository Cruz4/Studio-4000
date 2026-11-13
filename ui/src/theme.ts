import { useEffect, useState } from "react";
import { PALETTES, paletteTokens } from "./palettes";
const KEY = "studio4000-theme";
const DEFAULT_KEY = "studio4000-default-dark";
export const DEFAULT_DARK_THEME = "blue-storm";
export const DEFAULT_DARK_NAME = PALETTES.find((p) => p.id === DEFAULT_DARK_THEME)!.name;
export type ThemeName = "dark" | "light";
export function currentTheme(): ThemeName {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
export function currentPalette(): string {
  const root = document.documentElement;
  return root.dataset.palette ?? (root.dataset.theme === "dark-night" ? "dark-night" : currentTheme() === "light" ? "light" : DEFAULT_DARK_THEME);
}
export function applyTheme(theme: ThemeName) { applyPalette(theme === "dark" ? DEFAULT_DARK_THEME : "light"); }
export function applyPalette(id: string) {
  if (id === "dark") id = DEFAULT_DARK_THEME; // Carry the old default-dark preference forward.
  const root = document.documentElement;
  for (const key of Object.keys(paletteTokens(PALETTES[0]))) root.style.removeProperty(key);
  const palette = PALETTES.find((p) => p.id === id);
  if (palette) {
    root.dataset.theme = "dark";
    root.dataset.palette = palette.id;
    for (const [key, value] of Object.entries(paletteTokens(palette))) root.style.setProperty(key, value);
  } else if (id === "light" || id === "dark-night") {
    // Dark Night uses the original CSS without custom palette fill overrides.
    delete root.dataset.palette;
    root.dataset.theme = id;
  } else {
    applyPalette(DEFAULT_DARK_THEME);
    return;
  }
  try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
}
export function restoreTheme() {
  try {
    let saved = localStorage.getItem(KEY);
    if (localStorage.getItem(DEFAULT_KEY) !== DEFAULT_DARK_THEME) {
      // Move the previous default once; Studio Sessions remains selectable afterward.
      if (saved === "studio-sessions") saved = DEFAULT_DARK_THEME;
      localStorage.setItem(DEFAULT_KEY, DEFAULT_DARK_THEME);
    }
    applyPalette(saved ?? DEFAULT_DARK_THEME);
  } catch { applyPalette(DEFAULT_DARK_THEME); }
}
/** The toolbar alternates between Default Light and the default dark palette. */
export function toggleTheme() { applyTheme(currentTheme() === "light" ? "dark" : "light"); }
export function useThemeName() {
  const [name, setName] = useState(currentPalette);
  useEffect(() => {
    const obs = new MutationObserver(() => setName(currentPalette()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });
    return () => obs.disconnect();
  }, []);
  return name;
}
