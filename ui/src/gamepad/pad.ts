import { create } from "zustand";
import type { FaceLegend, Region, Layer } from "./types";

export interface WheelView {
  which: "lb" | "rb";
  title: string;
  items: { id: string; label: string }[];
  index: number | null;
}

interface PadState {
  enabled: boolean;
  connected: boolean;
  padName: string;
  playstation: boolean;
  region: Region | null;
  regionLabel: string;
  layer: Layer;
  wheel: WheelView | null;
  legend: FaceLegend;
  focus: Region | null;
  mapOpen: boolean;
  set: (patch: Partial<PadState>) => void;
}

export const usePad = create<PadState>((set) => ({
  enabled: true,
  connected: false,
  padName: "",
  playstation: false,
  region: null,
  regionLabel: "",
  layer: "bare",
  wheel: null,
  legend: {},
  focus: null,
  mapOpen: false,
  set: (patch) => set(patch),
}));

export function setGamepadFocus(focus: Region | null) {
  usePad.setState({ focus });
}
