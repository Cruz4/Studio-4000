import { act } from "./store";

// Turns a drop on another effect into the index plugin.move expects:
// the effect's place in the chain as it stands now, counting this effect.
export function pluginDropIndex(from: number, hit: number, after: boolean) {
  let dest = hit + (after ? 1 : 0);
  if (dest > from) dest -= 1;
  return dest;
}

/** Drag an effect by its header or slot. A short press still counts as a click. */
export function beginPluginReorder(e: React.PointerEvent, opts: {
  id: string; name: string; index: number; axis: "x" | "y"; item: HTMLElement; onClick?: () => void;
}) {
  if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, select, textarea")) return;
  const row = opts.item.parentElement;
  if (!row) return;
  const x0 = e.clientX, y0 = e.clientY;
  const horizontal = opts.axis === "x";
  let moved = false;
  let done = false;
  let dest = opts.index;
  let ghost: HTMLDivElement | null = null;
  const clear = () => row.querySelectorAll(".fx-held, .fx-drop-before, .fx-drop-after").forEach((el) => {
    el.classList.remove("fx-held", "fx-drop-before", "fx-drop-after");
  });
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    clear();
    ghost?.remove();
    document.body.classList.remove("reordering");
    if (!moved) opts.onClick?.();
    else if (dest !== opts.index) void act("plugin.move", { id: opts.id, index: dest });
  };
  const move = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
    if (!moved) {
      moved = true;
      document.body.classList.add("reordering");
      ghost = document.createElement("div");
      ghost.className = "fx-ghost";
      ghost.innerHTML = "<b></b><small></small>";
      document.body.appendChild(ghost);
    }
    clear();
    opts.item.classList.add("fx-held");
    const cards = [...row.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.dataset.pluginIndex != null);
    const hit = cards.find((c) => {
      const b = c.getBoundingClientRect();
      return horizontal ? ev.clientX >= b.left && ev.clientX < b.right : ev.clientY >= b.top && ev.clientY < b.bottom;
    });
    let after = false;
    let target: HTMLElement | null = hit ?? null;
    const hitIndex = hit?.dataset.pluginIndex != null ? Number(hit.dataset.pluginIndex) : null;
    if (hit && hitIndex != null && hitIndex !== opts.index) {
      // Touching a later effect puts this one after it. Touching an earlier one puts it before.
      after = hitIndex > opts.index;
      dest = pluginDropIndex(opts.index, hitIndex, after);
    } else if (!hit && cards.length) {
      const first = cards[0].getBoundingClientRect();
      const lastRect = cards[cards.length - 1].getBoundingClientRect();
      const beforeAll = horizontal ? ev.clientX < first.left : ev.clientY < first.top;
      const pastEnd = horizontal ? ev.clientX >= lastRect.right : ev.clientY >= lastRect.bottom;
      if (beforeAll || pastEnd) {
        after = pastEnd;
        target = pastEnd ? cards[cards.length - 1] : cards[0];
        dest = pluginDropIndex(opts.index, Number(target.dataset.pluginIndex), after);
      }
    } else dest = opts.index;
    if (dest !== opts.index && target) target.classList.add(after ? "fx-drop-after" : "fx-drop-before");
    if (ghost) {
      const name = target?.querySelector(".fx-card-name, .ellipsis")?.textContent?.trim() || "this effect";
      ghost.style.left = `${ev.clientX + 14}px`;
      ghost.style.top = `${ev.clientY + 16}px`;
      ghost.querySelector("b")!.textContent = opts.name;
      ghost.querySelector("small")!.textContent = dest === opts.index ? "Stays here" : after ? `After ${name}` : `Before ${name}`;
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
}
