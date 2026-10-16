import type { PointerEvent } from "react";
import emblem from "../assets/emblem.png";
import { commands } from "../commands";
import { useStore } from "../store";
import type { Project } from "../types";
import { cx } from "../util";
import { closeMenu, openMenu, useMenuOwner, type MenuItem } from "./ContextMenu";
import { Icon, ThemeToggle } from "./ui";

const MENUS: { label: string; items: string[] }[] = [
  { label: "File", items: ["new", "open", "save", "-", "import", "export", "archive", "reveal", "-", "audioSetup", "scan", "settings", "-", "quit"] },
  { label: "Edit", items: ["undo", "redo", "history", "-", "cut", "copy", "paste", "split", "duplicate", "delete", "selectAll", "-", "crossfade", "normalize", "muteClip"] },
  { label: "Track", items: ["addAudio", "addInst", "addBus", "addGroup", "-", "arm", "muteTrack", "soloTrack", "trackFx", "automation", "-", "vocalPop", "vocalWarm", "vocalPodcast"] },
  { label: "Clip", items: ["newMidiClip", "split", "duplicate", "delete", "muteClip", "-", "normalize", "crossfade", "quantize", "-", "loopSel", "editor"] },
  { label: "MIDI", items: ["typing", "keyboard", "octaveDown", "octaveUp", "panic", "-", "newMidiClip", "quantize", "-", "instruments"] },
  { label: "Transport", items: ["play", "record", "stop", "home", "end", "prevBar", "nextBar", "-", "loop", "punch", "click", "countIn", "marker"] },
  { label: "View", items: ["mixerView", "browser", "mixer", "editor", "smart", "assistant", "collab", "-", "zoomIn", "zoomOut", "zoomFit", "fullscreen"] },
  { label: "Help", items: ["guide", "shortcuts", "palette", "-", "effects", "-", "checkUpdate", "whatsNew", "-", "report", "coffee"] },
];

function itemsFor(ids: string[], project: Project | null): MenuItem[] {
  return ids.map((id) => {
    if (id === "-") return { separator: true };
    const c = commands.find((x) => x.id === id);
    if (!c) return { label: id, disabled: true };
    let label = c.title;
    let disabled = !!c.when && !c.when();
    if (id === "undo") { label = project?.undoName ? `Undo ${project.undoName}` : "Undo"; disabled = !project?.canUndo; }
    if (id === "redo") { label = project?.redoName ? `Redo ${project.redoName}` : "Redo"; disabled = !project?.canRedo; }
    return { label, keys: c.keys, icon: c.checked?.() ? "check" : undefined, disabled, run: c.run };
  });
}

/** File / Edit / Track / Clip / MIDI / Transport / View / Help, built from the same commands as the palette and shortcuts. */
export function MenuBar() {
  const owner = useMenuOwner();
  const project = useStore((s) => s.project);

  const show = (el: HTMLElement, label: string) => {
    const r = el.getBoundingClientRect();
    const menu = MENUS.find((m) => m.label === label)!;
    openMenu({ clientX: r.left, clientY: r.bottom + 2, preventDefault() {}, stopPropagation() {} }, itemsFor(menu.items, project), `menubar:${label}`);
  };

  return (
    <div className="menubar">
      <span className="menubar-brand"><img className="brand-mark" src={emblem} alt="" />Studio 4000</span>
      {MENUS.map((m) => {
        const mine = `menubar:${m.label}`;
        return (
          <button key={m.label} data-menu-owner={mine} className={cx("menubar-item", owner === mine && "on")}
            onPointerDown={(e: PointerEvent<HTMLButtonElement>) => { e.preventDefault(); if (owner === mine) closeMenu(); else show(e.currentTarget, m.label); }}
            onPointerEnter={(e) => { if (owner?.startsWith("menubar:") && owner !== mine) show(e.currentTarget, m.label); }}>
            {m.label}
          </button>
        );
      })}
      <div className="grow" />
      <ThemeToggle />
      {project && (
        <button className="menubar-item" title="Show or hide the browser panel (B)" onClick={() => useStore.setState((s) => ({ browserOpen: !s.browserOpen }))}>
          <Icon name="sidebar" size={13} />
        </button>
      )}
    </div>
  );
}
