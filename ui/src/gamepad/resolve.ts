import type { Layer, Region } from "./types";
import { applyDeadzone, type Button, type PadSnapshot } from "./poll";

export const HOLD_MS = 280;
export const REPEAT_DELAY = 320;
export const REPEAT_MS = 140;
export const DEADZONE = 0.18;

export interface PadMemory {
  downSince: Partial<Record<Button, number>>;
  held: Partial<Record<Button, boolean>>;
  repeatAt: Partial<Record<Button, number>>;
  wheel: { which: "lb" | "rb"; aimed: number | null } | null;
}

export type PadEvent =
  | { type: "face"; button: "a" | "b" | "x" | "y"; layer: Layer }
  | { type: "release"; button: "a" | "b" | "x" | "y"; layer: Layer }
  | { type: "tap"; button: "lb" | "rb"; layer: Layer }
  | { type: "wheel-open"; which: "lb" | "rb" }
  | { type: "wheel-confirm"; which: "lb" | "rb"; index: number }
  | { type: "wheel-cancel"; which: "lb" | "rb" }
  | { type: "dpad"; dir: "up" | "down" | "left" | "right"; layer: Layer }
  | { type: "click"; button: "l3" | "r3"; layer: Layer }
  | { type: "global"; id: "undo" | "redo" | "palette" | "map" };

export interface ResolveOptions {
  holdMs?: number;
  deadzone?: number;
  repeatDelay?: number;
  repeatMs?: number;
  lbWedges: number;
  rbWedges: number;
}

export interface ResolveResult {
  memory: PadMemory;
  events: PadEvent[];
  layer: Layer;
  axes: Record<"lx" | "ly" | "rx" | "ry", number>;
  triggers: { lt: number; rt: number };
  wheel: { which: "lb" | "rb"; index: number | null; count: number } | null;
}

export function emptyMemory(): PadMemory {
  return { downSince: {}, held: {}, repeatAt: {}, wheel: null };
}

/** 0 is up, then clockwise. A centred stick is not a wedge; callers check magnitude first. */
export function wedgeIndex(x: number, y: number, count: number): number {
  if (count <= 0) return 0;
  const angle = Math.atan2(x, -y);
  const tau = Math.PI * 2;
  const norm = (angle + tau) % tau;
  const step = tau / count;
  return Math.floor((norm + step / 2) / step) % count;
}

export interface RegionFlags {
  modal: boolean;
  project: boolean;
  focus: Region | null;
  view: "tracks" | "mixer";
  bottom: string | null;
  browserOpen: boolean;
  side: string | null;
  keysOpen: boolean;
  pluginOpen: boolean;
}

/** The focused region wins when that screen is actually open. Otherwise the page decides. */
export function pickRegion(flags: RegionFlags): Region {
  if (flags.modal) return "modal";
  if (flags.focus && regionAvailable(flags.focus, flags)) return flags.focus;
  if (!flags.project) return "welcome";
  if (flags.view === "mixer") return "mixer";
  if (flags.bottom === "editor") return "editor";
  return "arrange";
}

export function regionAvailable(region: Region, flags: RegionFlags): boolean {
  switch (region) {
    case "modal": return flags.modal;
    case "welcome": return !flags.project;
    case "arrange": return flags.project && flags.view !== "mixer";
    case "mixer": return flags.project && (flags.view === "mixer" || flags.bottom === "mixer");
    case "editor": return !!flags.project && flags.bottom === "editor";
    case "effects": return !!flags.project && flags.bottom === "effects";
    case "smart": return !!flags.project && flags.bottom === "smart";
    case "browser": return !!flags.project && flags.browserOpen;
    case "assistant": return flags.side === "assistant";
    case "side": return !!flags.side;
    case "keyboard": return flags.keysOpen;
    case "plugin": return flags.pluginOpen;
    default: return false;
  }
}

const FACES = ["a", "b", "x", "y"] as const;
const CLICKS = ["l3", "r3"] as const;
const DPAD = ["up", "down", "left", "right"] as const;
const ALL: Button[] = ["a", "b", "x", "y", "lb", "rb", "lt", "rt", "back", "start", "l3", "r3", "up", "down", "left", "right"];

/** One poll turned into taps, holds, wheel aim, and the trigger layer. */
export function resolveFrame(memory: PadMemory, snap: PadSnapshot, now: number, opts: ResolveOptions): ResolveResult {
  const holdMs = opts.holdMs ?? HOLD_MS;
  const repeatDelay = opts.repeatDelay ?? REPEAT_DELAY;
  const repeatMs = opts.repeatMs ?? REPEAT_MS;
  const dz = opts.deadzone ?? DEADZONE;
  const axes = {
    lx: applyDeadzone(snap.axes.lx, dz),
    ly: applyDeadzone(snap.axes.ly, dz),
    rx: applyDeadzone(snap.axes.rx, dz),
    ry: applyDeadzone(snap.axes.ry, dz),
  };
  const layer: Layer = snap.buttons.lt ? "lt" : snap.buttons.rt ? "rt" : "bare";
  const events: PadEvent[] = [];
  const downSince: PadMemory["downSince"] = { ...memory.downSince };
  const held: PadMemory["held"] = { ...memory.held };
  const repeatAt: PadMemory["repeatAt"] = { ...memory.repeatAt };
  let wheel = memory.wheel ? { ...memory.wheel } : null;

  const pressed: Button[] = [];
  const released: Button[] = [];
  for (const b of ALL) {
    const down = !!snap.buttons[b];
    const was = memory.downSince[b] !== undefined;
    if (down && !was) {
      downSince[b] = now;
      pressed.push(b);
    } else if (!down && was) {
      released.push(b);
      delete downSince[b];
    }
  }

  const startPressed = pressed.includes("start");
  const backPressed = pressed.includes("back");
  if ((startPressed && snap.buttons.back) || (backPressed && snap.buttons.start)) {
    events.push({ type: "global", id: "map" });
  } else if (!wheel) {
    if (backPressed) events.push({ type: "global", id: layer === "lt" ? "redo" : "undo" });
    if (startPressed) events.push({ type: "global", id: "palette" });
  }

  const shoulder = (which: "lb" | "rb", count: number) => {
    const down = snap.buttons[which];
    if (down && !held[which] && downSince[which] !== undefined && now - downSince[which]! >= holdMs && count > 0 && (!wheel || wheel.which === which)) {
      held[which] = true;
      wheel = { which, aimed: null };
      events.push({ type: "wheel-open", which });
    }
    if (wheel?.which === which && (down || released.includes(which))) {
      const mag = Math.hypot(axes.lx, axes.ly);
      wheel = { which, aimed: mag > 0 && count > 0 ? wedgeIndex(axes.lx, axes.ly, count) : null };
    }
    if (released.includes(which)) {
      const started = memory.downSince[which] ?? now;
      if (memory.held[which]) {
        const aimed = wheel?.which === which ? wheel.aimed : null;
        if (aimed !== null && aimed !== undefined) events.push({ type: "wheel-confirm", which, index: aimed });
        else events.push({ type: "wheel-cancel", which });
      } else if (now - started < holdMs && !(memory.wheel && memory.wheel.which !== which)) {
        events.push({ type: "tap", button: which, layer });
      }
      if (wheel?.which === which) wheel = null;
      delete held[which];
    }
  };

  shoulder("lb", opts.lbWedges);
  shoulder("rb", opts.rbWedges);

  if (!wheel) {
    for (const button of FACES) {
      if (pressed.includes(button)) events.push({ type: "face", button, layer });
      if (released.includes(button)) events.push({ type: "release", button, layer });
    }
    for (const button of CLICKS) {
      if (pressed.includes(button)) events.push({ type: "click", button, layer });
    }
    for (const dir of DPAD) {
      if (pressed.includes(dir)) {
        events.push({ type: "dpad", dir, layer });
        repeatAt[dir] = now + repeatDelay;
      } else if (snap.buttons[dir] && repeatAt[dir] !== undefined && now >= repeatAt[dir]!) {
        events.push({ type: "dpad", dir, layer });
        repeatAt[dir] = now + repeatMs;
      }
    }
  }

  return {
    memory: { downSince, held, repeatAt, wheel },
    events,
    layer,
    axes,
    triggers: snap.triggers,
    wheel: wheel ? { which: wheel.which, index: wheel.aimed, count: wheel.which === "lb" ? opts.lbWedges : opts.rbWedges } : null,
  };
}
