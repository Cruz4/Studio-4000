import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installShortcuts } from "./commands";
import { installMusicalTyping } from "./keys";
import { initEvents, loadCatalogue, refreshInfo, refreshProject, toast } from "./store";
import "./styles.css";

initEvents();
installMusicalTyping();
installShortcuts();

// Files dropped anywhere outside a drop target must not navigate the webview away.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
window.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement;
  if (!(el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.closest("pre"))) e.preventDefault();
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = (e.reason as Error)?.message ?? String(e.reason);
  if (msg && !/abort/i.test(msg)) toast(msg, "error");
});

refreshInfo().catch(() => {});
refreshProject();
loadCatalogue().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
