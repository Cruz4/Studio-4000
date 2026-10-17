/** Regions the controller can focus. A modal always wins over these. */
export type Region =
  | "welcome" | "arrange" | "mixer" | "editor" | "effects" | "browser"
  | "smart" | "assistant" | "side" | "keyboard" | "plugin" | "modal";

export type Layer = "bare" | "lt" | "rt";
export type FaceButton = "a" | "b" | "x" | "y";
export type StickAxis = "lx" | "ly" | "rx" | "ry";
export type DpadDir = "up" | "down" | "left" | "right";

export interface Action {
  label: string;
  run: () => void;
  release?: () => void;
}

export interface WheelItem {
  id: string;
  label: string;
  run: () => void;
}

export interface FrameContext {
  layer: Layer;
  dt: number;
  axes: Record<StickAxis, number>;
  triggers: { lt: number; rt: number };
  wheel: boolean;
}

/** What the focused screen does with the pad. */
export interface Bindings {
  title: string;
  bare: Partial<Record<FaceButton, Action>>;
  lt?: Partial<Record<FaceButton, Action>>;
  rt?: Partial<Record<FaceButton, Action>>;
  lbTap?: Action;
  rbTap?: Action;
  /** Hold LB and aim with the left stick. */
  wheel?: WheelItem[];
  /** Return true when the screen handled the direction. */
  onDpad?: (dir: DpadDir, layer: Layer) => boolean;
  /** Return true when the screen handled the stick click. */
  onClick?: (button: "l3" | "r3", layer: Layer) => boolean;
  /** Continuous sticks. Called every frame the wheel is closed. */
  onFrame?: (frame: FrameContext) => void;
  /** Return true to swallow a global (undo, palette, map). */
  onGlobal?: (id: "undo" | "redo" | "palette" | "map", layer: Layer) => boolean;
}

export interface FaceLegend {
  a?: string;
  b?: string;
  x?: string;
  y?: string;
  hint?: string;
}
