import { act } from "./store";

/** An effect already on a chain, dropped onto a track to copy it there. Not a browser instrument. */
export const FX_COPY = "application/x-s3-fx-copy";

// Turns a drop on another effect into the index plugin.move expects:
// the effect's place in the chain as it stands now, counting this effect.
export function pluginDropIndex(from: number, hit: number, after: boolean) {
  let dest = hit + (after ? 1 : 0);
  if (dest > from) dest -= 1;
  return dest;
}

/** Selected effects travel as one block. Null means the chain stays as it is. */
export function groupOrder(order: string[], moving: string[], hitIndex: number | null, after: boolean): string[] | null {
  const selected = new Set(moving);
  const block = order.filter((id) => selected.has(id));
  if (block.length < 2) return null;
  const rest = order.filter((id) => !selected.has(id));
  let at = after ? rest.length : 0;
  if (hitIndex != null && hitIndex >= 0 && hitIndex < order.length) {
    const hitId = order[hitIndex];
    if (selected.has(hitId)) return null;
    const found = rest.indexOf(hitId);
    if (found < 0) return null;
    at = found + (after ? 1 : 0);
  }
  const next = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  if (next.length !== order.length || next.every((id, i) => id === order[i])) return null;
  return next;
}

/** Moves plug-ins one at a time so each index is the chain as it stands then. */
export async function applyPluginOrder(next: string[], current: string[]) {
  const live = [...current];
  const calls: { method: string; params: { id: string; index: number } }[] = [];
  for (let i = 0; i < next.length; i++) {
    const from = live.indexOf(next[i]);
    if (from < 0 || from === i) continue;
    calls.push({ method: "plugin.move", params: { id: next[i], index: i } });
    const [item] = live.splice(from, 1);
    live.splice(i, 0, item);
  }
  if (calls.length) await act("batch.run", { label: "Reorder effects", calls });
}

/** Drag an effect by its header or slot. A short press still counts as a click. */
export function beginPluginReorder(e: React.PointerEvent, opts: {
  id: string; name: string; index: number; axis: "x" | "y"; item: HTMLElement; onClick?: () => void;
  ids?: string[]; order?: string[];
}) {
  if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, select, textarea")) return;
  const row = opts.item.parentElement;
  if (!row) return;
  const x0 = e.clientX, y0 = e.clientY;
  const horizontal = opts.axis === "x";
  const multi = (opts.ids?.length ?? 0) > 1 && !!opts.order;
  let moved = false;
  let done = false;
  let dest = opts.index;
  let grouped: string[] | null = null;
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
    else if (multi && grouped && opts.order) void applyPluginOrder(grouped, opts.order);
    else if (!multi && dest !== opts.index) void act("plugin.move", { id: opts.id, index: dest });
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
    if (multi && opts.ids) {
      for (const id of opts.ids) row.querySelector(`[data-plugin="${CSS.escape(id)}"]`)?.classList.add("fx-held");
    } else opts.item.classList.add("fx-held");
    const cards = [...row.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.dataset.pluginIndex != null);
    const hit = cards.find((c) => {
      const b = c.getBoundingClientRect();
      return horizontal ? ev.clientX >= b.left && ev.clientX < b.right : ev.clientY >= b.top && ev.clientY < b.bottom;
    });
    let after = false;
    let target: HTMLElement | null = hit ?? null;
    const hitIndex = hit?.dataset.pluginIndex != null ? Number(hit.dataset.pluginIndex) : null;
    grouped = null;
    if (hit && hitIndex != null && hitIndex !== opts.index) {
      after = hitIndex > opts.index;
      if (multi && opts.order && opts.ids) grouped = groupOrder(opts.order, opts.ids, hitIndex, after);
      else dest = pluginDropIndex(opts.index, hitIndex, after);
    } else if (!hit && cards.length) {
      const first = cards[0].getBoundingClientRect();
      const lastRect = cards[cards.length - 1].getBoundingClientRect();
      const beforeAll = horizontal ? ev.clientX < first.left : ev.clientY < first.top;
      const pastEnd = horizontal ? ev.clientX >= lastRect.right : ev.clientY >= lastRect.bottom;
      if (beforeAll || pastEnd) {
        after = pastEnd;
        target = pastEnd ? cards[cards.length - 1] : cards[0];
        if (multi && opts.order && opts.ids) grouped = groupOrder(opts.order, opts.ids, null, after);
        else dest = pluginDropIndex(opts.index, Number(target.dataset.pluginIndex), after);
      }
    } else dest = opts.index;
    const placing = multi ? !!grouped : dest !== opts.index;
    if (placing && target) target.classList.add(after ? "fx-drop-after" : "fx-drop-before");
    if (ghost) {
      const name = target?.querySelector(".fx-card-name, .ellipsis")?.textContent?.trim() || "this effect";
      ghost.style.left = `${ev.clientX + 14}px`;
      ghost.style.top = `${ev.clientY + 16}px`;
      ghost.querySelector("b")!.textContent = multi ? `${opts.ids!.length} effects` : opts.name;
      ghost.querySelector("small")!.textContent = !placing ? "Stays here" : after ? `After ${name}` : `Before ${name}`;
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
}
