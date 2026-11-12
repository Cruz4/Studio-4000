import { useEffect, useState } from "react";
import { PALETTES, paletteTokens } from "./palettes";
const KEY = "studio4000-theme";
export type ThemeName = "dark" | "light";
export function currentTheme(): ThemeName {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
export function currentPalette(): string { return document.documentElement.dataset.palette ?? currentTheme(); }
export function applyTheme(theme: ThemeName) { applyPalette(theme); }
export function applyPalette(id: string) {
  const root = document.documentElement;
  for (const key of Object.keys(paletteTokens(PALETTES[0]))) root.style.removeProperty(key);
  const palette = PALETTES.find((p) => p.id === id);
  if (palette) {
    root.dataset.theme = "dark";
    root.dataset.palette = palette.id;
    for (const [key, value] of Object.entries(paletteTokens(palette))) root.style.setProperty(key, value);
  } else {
    delete root.dataset.palette;
    root.dataset.theme = id === "light" ? "light" : "dark";
    id = currentTheme();
  }
  try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
}
export function restoreTheme() {
  try { applyPalette(localStorage.getItem(KEY) ?? "dark"); } catch { applyPalette("dark"); }
}
/** Toolbar selects only the two default themes. */
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
