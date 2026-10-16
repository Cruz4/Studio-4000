import type { PointerEvent as ReactPointerEvent } from "react";
import { act, useStore } from "./store";

/** Drag a track to a new slot. A floating label follows the pointer, and a line marks the drop. */
export function beginTrackReorder(e: ReactPointerEvent, opts: {
  id: string;
  name: string;
  colour: string;
  axis: "x" | "y";
  source: HTMLElement;
}) {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  const { id, name, colour, axis, source } = opts;
  const scope = source.closest(axis === "x" ? ".mixer" : ".arrange") ?? document;
  const itemSelector = axis === "x" ? ".strip[data-track]" : ".track-row[data-track]";
  let moved = false;
  let after: string | null | undefined;
  let ghost: HTMLDivElement | null = null;

  const clearMarks = () => {
    scope.querySelectorAll(".reorder-held, .drop-before, .drop-after").forEach((el) => {
      el.classList.remove("reorder-held", "drop-before", "drop-after");
    });
  };

  const placeGhost = (ev: PointerEvent, where: string) => {
    if (!ghost) {
      ghost = document.createElement("div");
      ghost.className = "reorder-ghost";
      const bar = document.createElement("i");
      const title = document.createElement("b");
      const sub = document.createElement("small");
      ghost.append(bar, title, sub);
      document.body.appendChild(ghost);
      document.body.classList.add("reordering");
    }
    const bar = ghost.querySelector("i") as HTMLElement;
    const title = ghost.querySelector("b") as HTMLElement;
    const sub = ghost.querySelector("small") as HTMLElement;
    bar.style.background = colour;
    title.textContent = name;
    sub.textContent = where;
    ghost.style.left = `${Math.min(ev.clientX + 16, window.innerWidth - 240)}px`;
    ghost.style.top = `${Math.min(ev.clientY + 18, window.innerHeight - 52)}px`;
  };

  const hitAt = (ev: PointerEvent) => {
    const items = [...scope.querySelectorAll<HTMLElement>(itemSelector)];
    let best: HTMLElement | null = null;
    let bestDist = 36;
    for (const el of items) {
      const b = el.getBoundingClientRect();
      if (axis === "x") {
        if (ev.clientY < b.top - 28 || ev.clientY > b.bottom + 28) continue;
        const dx = ev.clientX < b.left ? b.left - ev.clientX : ev.clientX > b.right ? ev.clientX - b.right : 0;
        if (dx < bestDist) { bestDist = dx; best = el; }
      } else {
        if (ev.clientX < b.left - 24 || ev.clientX > b.right + 80) continue;
        const dy = ev.clientY < b.top ? b.top - ev.clientY : ev.clientY > b.bottom ? ev.clientY - b.bottom : 0;
        if (dy < bestDist) { bestDist = dy; best = el; }
      }
    }
    return best;
  };

  const move = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
    if (!moved) {
      moved = true;
      const active = document.activeElement;
      if (active instanceof HTMLElement && source.contains(active)) active.blur();
      window.getSelection()?.removeAllRanges();
    }
    const hit = hitAt(ev);
    clearMarks();
    source.classList.add("reorder-held");
    if (!hit) {
      after = undefined;
      placeGhost(ev, "Drag onto a track");
      return;
    }
    const b = hit.getBoundingClientRect();
    const hitId = hit.dataset.track!;
    const tracks = useStore.getState().project?.tracks ?? [];
    const i = tracks.findIndex((t) => t.id === hitId);
    const before = axis === "x" ? ev.clientX < b.left + b.width / 2 : ev.clientY < b.top + b.height / 2;
    after = before ? (i <= 0 ? null : tracks[i - 1].id) : hitId;
    hit.classList.add(before ? "drop-before" : "drop-after");
    const hitName = tracks[i]?.name ?? "track";
    if (after === id) {
      after = undefined;
      placeGhost(ev, "Stays here");
      return;
    }
    const where = axis === "x"
      ? (before ? (i <= 0 ? "Drop at the start" : `Drop left of ${hitName}`) : `Drop right of ${hitName}`)
      : (before ? (i <= 0 ? "Drop at the top" : `Drop above ${hitName}`) : `Drop below ${hitName}`);
    placeGhost(ev, where);
  };

  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    clearMarks();
    ghost?.remove();
    document.body.classList.remove("reordering");
    if (!moved || after === undefined || after === id) return;
    act("track.move", after ? { id, afterId: after } : { id });
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}
