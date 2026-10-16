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
