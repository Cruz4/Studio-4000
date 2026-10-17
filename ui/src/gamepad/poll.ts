/** Standard Gamepad API mapping. Xbox names; PlayStation pads land on the same indexes. */
export const BUTTONS = [
  "a", "b", "x", "y", "lb", "rb", "lt", "rt", "back", "start", "l3", "r3", "up", "down", "left", "right",
] as const;

export type Button = (typeof BUTTONS)[number];

export const BUTTON_INDEX: Record<Button, number> = {
  a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, l3: 10, r3: 11,
  up: 12, down: 13, left: 14, right: 15,
};

export interface PadButton {
  pressed: boolean;
  value: number;
}

export interface PadLike {
  id: string;
  mapping: string;
  connected: boolean;
  buttons: PadButton[];
  axes: number[];
}

export interface PadSnapshot {
  id: string;
  buttons: Record<Button, boolean>;
  axes: Record<"lx" | "ly" | "rx" | "ry", number>;
  triggers: { lt: number; rt: number };
}

const TRIGGER_ON = 0.55;

export function blankButtons(): Record<Button, boolean> {
  return { a: false, b: false, x: false, y: false, lb: false, rb: false, lt: false, rt: false, back: false, start: false, l3: false, r3: false, up: false, down: false, left: false, right: false };
}

/** First connected pad that exposes the standard mapping. Others are ignored. */
export function readStandardPad(pads: Array<PadLike | null>): PadSnapshot | null {
  for (const pad of pads) {
    if (!pad || !pad.connected || pad.mapping !== "standard" || pad.buttons.length < 16) continue;
    const buttons = blankButtons();
    for (const name of BUTTONS) {
      const b = pad.buttons[BUTTON_INDEX[name]];
      buttons[name] = !!b && (b.pressed || b.value > TRIGGER_ON);
    }
    const axis = (i: number) => {
      const v = pad.axes[i] ?? 0;
      return Math.max(-1, Math.min(1, v));
    };
    return {
      id: pad.id || "Controller",
      buttons,
      axes: { lx: axis(0), ly: axis(1), rx: axis(2), ry: axis(3) },
      triggers: { lt: pad.buttons[6]?.value ?? (buttons.lt ? 1 : 0), rt: pad.buttons[7]?.value ?? (buttons.rt ? 1 : 0) },
    };
  }
  return null;
}

/** Shrinks a stick so the slack around the centre becomes zero, and full deflection stays 1. */
export function applyDeadzone(v: number, dz = 0.18): number {
  const a = Math.abs(v);
  if (a <= dz || dz >= 1) return 0;
  return Math.sign(v) * (a - dz) / (1 - dz);
}
