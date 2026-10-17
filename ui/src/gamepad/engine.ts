import { rpc } from "../bridge";
import { runCommand } from "../commands";
import { useStore } from "../store";
import { customBindings } from "./surfaces";
import { usePad } from "./pad";
import { readStandardPad, type PadLike } from "./poll";
import { emptyMemory, pickRegion, resolveFrame, type PadMemory, type RegionFlags } from "./resolve";
import { PLACES, builtinBindings, releaseHeldNotes, sharedDpad } from "./regions";
import type { Bindings, FaceButton, FaceLegend, Layer, Region, WheelItem } from "./types";

const PS = /dualsense|dualshock|playstation|sony|wireless controller/i;

function flags(): RegionFlags {
  const s = useStore.getState();
  return {
    modal: !!document.querySelector(".modal, .pad-menu"),
    project: !!s.project,
    focus: usePad.getState().focus,
    view: s.view,
    bottom: s.bottom,
    browserOpen: s.browserOpen,
    side: s.side,
    keysOpen: s.keysOpen,
    pluginOpen: s.openPlugins.length > 0,
  };
}

function bindingsFor(region: Region): Bindings {
  return customBindings(region) ?? builtinBindings(region);
}

function legendFor(bindings: Bindings, layer: Layer): FaceLegend {
  const faces = (layer === "lt" ? bindings.lt : layer === "rt" ? bindings.rt : bindings.bare) ?? bindings.bare;
  const hint = layer === "lt" ? "LT edit" : layer === "rt" ? "RT alternate" : "Hold LB for tools · Hold RB for places";
  return { a: faces.a?.label, b: faces.b?.label, x: faces.x?.label, y: faces.y?.label, hint };
}

function cyclePlaces(dir: number) {
  const current = usePad.getState().focus ?? usePad.getState().region;
  const index = Math.max(0, PLACES.findIndex((place) => place.id === current));
  PLACES[(index + dir + PLACES.length) % PLACES.length]?.run();
}

let published = "";
function publish(next: { connected: boolean; padName: string; playstation: boolean; region: Region | null; regionLabel: string; layer: Layer; wheel: { which: "lb" | "rb"; title: string; items: { id: string; label: string }[]; index: number | null } | null; legend: FaceLegend }) {
  const key = JSON.stringify(next);
  if (key === published) return;
  published = key;
  usePad.setState(next);
}

/** Polls a USB game controller and routes it to the screen in front. */
export function installGamepad() {
  let memory: PadMemory = emptyMemory();
  let last = performance.now();
  let region: Region | null = null;
  let openWheel: { which: "lb" | "rb"; items: WheelItem[] } | null = null;
  const faceLayer: Partial<Record<FaceButton, Layer>> = {};
  let raf = 0;

  rpc<string>("settings.get", { key: "gamepad" }).then((value) => {
    if (value === "0") usePad.setState({ enabled: false });
  }).catch(() => {});

  let plugins = useStore.getState().openPlugins.length;
  const unsub = useStore.subscribe((state) => {
    if (state.openPlugins.length > plugins) usePad.setState({ focus: "plugin" });
    if (state.openPlugins.length === 0 && usePad.getState().focus === "plugin") usePad.setState({ focus: null });
    plugins = state.openPlugins.length;
  });

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const pads = navigator.getGamepads ? [...navigator.getGamepads()] as Array<PadLike | null> : [];
    const snap = readStandardPad(pads);
    if (!snap || !usePad.getState().enabled) {
      memory = emptyMemory();
      openWheel = null;
      releaseHeldNotes();
      publish({
        connected: !!snap, padName: snap?.id ?? "", playstation: !!snap && PS.test(snap.id),
        region, regionLabel: snap && !usePad.getState().enabled ? "Controller off" : "", layer: "bare", wheel: null, legend: {},
      });
      raf = requestAnimationFrame(tick);
      return;
    }

    const nextRegion = pickRegion(flags());
    if (nextRegion !== region) { releaseHeldNotes(); region = nextRegion; }
    const bindings = bindingsFor(nextRegion);
    const lbWedges = openWheel?.which === "lb" ? openWheel.items.length : (bindings.wheel?.length ?? 0);
    const rbWedges = nextRegion === "modal" ? 0 : (openWheel?.which === "rb" ? openWheel.items.length : PLACES.length);
    const frame = resolveFrame(memory, snap, now, { lbWedges, rbWedges });
    memory = frame.memory;

    for (const event of frame.events) {
      if (event.type === "global") {
        if (!bindings.onGlobal?.(event.id, frame.layer)) {
          if (event.id === "undo") runCommand("undo");
          else if (event.id === "redo") runCommand("redo");
          else if (event.id === "palette") useStore.setState((s) => ({ paletteOpen: !s.paletteOpen }));
          else usePad.setState({ mapOpen: true });
        }
      } else if (event.type === "wheel-open") {
        const items = event.which === "rb" ? PLACES : (bindings.wheel ?? []);
        openWheel = { which: event.which, items };
      } else if (event.type === "wheel-confirm") {
        openWheel?.items[event.index]?.run();
        openWheel = null;
      } else if (event.type === "wheel-cancel") {
        openWheel = null;
      } else if (event.type === "tap") {
        const action = event.button === "lb" ? bindings.lbTap : bindings.rbTap;
        if (action) action.run();
        else if (event.button === "rb") cyclePlaces(1);
        else cyclePlaces(-1);
      } else if (event.type === "face") {
        faceLayer[event.button] = event.layer;
        const faces = (event.layer === "lt" ? bindings.lt : event.layer === "rt" ? bindings.rt : bindings.bare) ?? bindings.bare;
        faces[event.button]?.run();
      } else if (event.type === "release") {
        const held = faceLayer[event.button] ?? event.layer;
        delete faceLayer[event.button];
        const faces = (held === "lt" ? bindings.lt : held === "rt" ? bindings.rt : bindings.bare) ?? bindings.bare;
        faces[event.button]?.release?.();
      } else if (event.type === "dpad") {
        if (!bindings.onDpad?.(event.dir, event.layer)) sharedDpad(event.dir, event.layer);
      } else if (event.type === "click") {
        if (!bindings.onClick?.(event.button, event.layer)) {
          if (event.button === "l3") runCommand("loop");
          else runCommand("click");
        }
      }
    }

    if (!frame.wheel) bindings.onFrame?.({ layer: frame.layer, dt, axes: frame.axes, triggers: frame.triggers, wheel: false });

    const wheelView = frame.wheel && openWheel ? {
      which: frame.wheel.which,
      title: frame.wheel.which === "rb" ? "Places" : bindings.title,
      items: openWheel.items.map((item) => ({ id: item.id, label: item.label })),
      index: frame.wheel.index,
    } : null;

    publish({
      connected: true,
      padName: snap.id,
      playstation: PS.test(snap.id),
      region: nextRegion,
      regionLabel: bindings.title,
      layer: frame.layer,
      wheel: wheelView,
      legend: wheelView ? {} : legendFor(bindings, frame.layer),
    });
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(raf); unsub(); };
}
