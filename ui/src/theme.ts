import { useEffect, useState } from "react";

const KEY = "studio4000-theme";

export type ThemeName = "dark" | "light";

export function currentTheme(): ThemeName {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function applyTheme(theme: ThemeName) {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
}

export function toggleTheme() {
  applyTheme(currentTheme() === "light" ? "dark" : "light");
}

/** Redraws canvases that read the theme colours when Light or Dark is clicked. */
export function useThemeName() {
  const [name, setName] = useState(currentTheme);
  useEffect(() => {
    const obs = new MutationObserver(() => setName(currentTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return name;
}
