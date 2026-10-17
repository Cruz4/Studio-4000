import { useEffect, useRef } from "react";
import type { Bindings, Region } from "./types";

export interface Surface {
  id: string;
  region: Region;
  active: () => boolean;
  bindings: () => Bindings;
}

const registry = new Map<string, Surface>();

export function registerSurface(surface: Surface) {
  registry.set(surface.id, surface);
  return () => { if (registry.get(surface.id) === surface) registry.delete(surface.id); };
}

/** A screen with its own state (the piano roll, the start page) supplies bindings while it is mounted. */
export function useGamepadSurface(surface: Surface) {
  const ref = useRef(surface);
  ref.current = surface;
  useEffect(() => registerSurface({
    id: surface.id,
    region: surface.region,
    active: () => ref.current.active(),
    bindings: () => ref.current.bindings(),
  }), [surface.id, surface.region]);
}

export function customBindings(region: Region): Bindings | null {
  for (const surface of registry.values()) {
    if (surface.region === region && surface.active()) return surface.bindings();
  }
  return null;
}
