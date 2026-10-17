import { closeMenu } from "../components/ContextMenu";

const SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  ".palette-item",
  ".menu-row",
  ".tab",
  "[data-pad]",
].join(",");

const indexByRoot = new WeakMap<Element, number>();

export function padRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".pad-menu") ?? document.querySelector<HTMLElement>(".modal");
}

function visible(el: HTMLElement) {
  const rects = el.getClientRects();
  return rects.length > 0 && rects[0].width > 0 && rects[0].height > 0;
}

export function padItems(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(SELECTOR)].filter(visible);
}

function paint(root: Element, items: HTMLElement[], index: number) {
  root.querySelectorAll("[data-pad-focus]").forEach((el) => el.removeAttribute("data-pad-focus"));
  const el = items[index];
  if (!el) return;
  el.setAttribute("data-pad-focus", "");
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function crawlMove(root: Element, delta: number) {
  const items = padItems(root);
  if (!items.length) return;
  const cur = indexByRoot.get(root) ?? 0;
  const next = Math.max(0, Math.min(items.length - 1, cur + delta));
  indexByRoot.set(root, next);
  paint(root, items, next);
}

export function crawlActivate(root: Element) {
  const items = padItems(root);
  const el = items[indexByRoot.get(root) ?? 0];
  el?.click();
}

export function crawlSync(root: Element) {
  const items = padItems(root);
  if (!items.length) return;
  const cur = Math.max(0, Math.min(items.length - 1, indexByRoot.get(root) ?? 0));
  indexByRoot.set(root, cur);
  paint(root, items, cur);
}

export function cycleTabs(dir: number) {
  const tabs = [...document.querySelectorAll<HTMLElement>(".modal .tabs .tab")];
  if (tabs.length < 2) return false;
  const current = Math.max(0, tabs.findIndex((tab) => tab.classList.contains("on")));
  tabs[(current + dir + tabs.length) % tabs.length]?.click();
  return true;
}

/** B in a dialog: the same as Escape, or the dialog's Close / Cancel button. */
export function closeDialog() {
  if (document.querySelector(".pad-menu")) {
    closeMenu();
    return;
  }
  const modal = document.querySelector(".modal");
  if (!modal) return;
  const closeBtn = modal.querySelector<HTMLElement>('button[title="Close"]');
  if (closeBtn) { closeBtn.click(); return; }
  const cancel = [...modal.querySelectorAll("button")].find((button) => /cancel/i.test(button.textContent ?? ""));
  if (cancel) { cancel.click(); return; }
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  modal.querySelector("input, textarea")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

export function mark(selector: string, attr: string, value: string | null) {
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    if (value !== null && el.getAttribute(attr) === value) el.setAttribute("data-pad-focus", "");
    else el.removeAttribute("data-pad-focus");
  });
}
