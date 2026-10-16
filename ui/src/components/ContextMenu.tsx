import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Icon } from "./ui";

export interface MenuItem {
  label?: string;
  icon?: string;
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Shown while the pointer is on the row. */
  title?: string;
  run?: () => unknown;
  colours?: { value: string; run: (c: string) => void };
  separator?: boolean;
}

const useMenu = create<{ x: number; y: number; items: MenuItem[] | null; owner?: string }>(() => ({ x: 0, y: 0, items: null }));

/** `owner` names whoever opened the menu (the menu bar uses it to switch menus on hover). */
export function openMenu(e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void }, items: MenuItem[], owner?: string) {
  e.preventDefault();
  e.stopPropagation();
  useMenu.setState({ x: e.clientX, y: e.clientY, items, owner });
}

export const useMenuOwner = () => useMenu((s) => (s.items ? s.owner : undefined));

export function closeMenu() {
  useMenu.setState({ items: null });
}

export const PALETTE = ["#7c5cff", "#00d1ff", "#21e6a5", "#ffc857", "#ff8a3d", "#ff4d6d", "#ff6bd5", "#a08bff", "#4dd4ff", "#9be15d"];

export function ContextMenu() {
  const { x, y, items, owner } = useMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y, items]);

  useEffect(() => {
    if (!items) return;
    const close = (e: Event) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t)) return;
      if (owner && t.closest?.(`[data-menu-owner="${owner}"]`)) return;
      useMenu.setState({ items: null });
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && useMenu.setState({ items: null });
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", () => useMenu.setState({ items: null }), { once: true });
    return () => { window.removeEventListener("pointerdown", close, true); window.removeEventListener("keydown", key); };
  }, [items, owner]);

  if (!items) return null;
  return (
    <div ref={ref} style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 300, minWidth: 200, padding: 5, background: "var(--bg3)", border: "1px solid var(--line2)", borderRadius: 10, boxShadow: "0 18px 50px rgba(0,0,0,.55)" }}>
      {items.map((it, i) => {
        if (it.separator) return <div key={i} style={{ height: 1, background: "var(--line)", margin: "4px 2px" }} />;
        if (it.colours) {
          return (
            <div key={i} className="row" style={{ padding: "6px 8px", gap: 5, flexWrap: "wrap" }}>
              {PALETTE.map((c) => (
                <button key={c} title={c} onClick={() => { it.colours!.run(c); useMenu.setState({ items: null }); }}
                  style={{ width: 16, height: 16, borderRadius: 5, border: c === it.colours!.value ? "2px solid #fff" : "none", background: c, cursor: "pointer" }} />
              ))}
            </div>
          );
        }
        return (
          <div key={i} className="palette-item menu-row" aria-label={it.title} style={{ padding: "6px 8px", opacity: it.disabled ? 0.4 : 1, color: it.danger ? "var(--red)" : undefined }}
            onClick={() => { if (it.disabled) return; useMenu.setState({ items: null }); it.run?.(); }}>
            <span style={{ width: 16, display: "inline-flex" }}>{it.icon && <Icon name={it.icon} size={14} />}</span>
            <span className="grow">{it.label}</span>
            {it.keys && <span className="kbd">{it.keys}</span>}
            {it.title && <span className="menu-tip">{it.title}</span>}
          </div>
        );
      })}
    </div>
  );
}
