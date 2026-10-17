import { describe, expect, it } from "vitest";
import { applyDeadzone, blankButtons, readStandardPad, type PadLike, type PadSnapshot } from "./poll";
import { emptyMemory, pickRegion, resolveFrame, wedgeIndex, type RegionFlags } from "./resolve";

function pad(partial: Partial<PadLike> & { pressed?: number[] }): PadLike {
  const pressed = new Set(partial.pressed ?? []);
  return {
    id: partial.id ?? "Xbox Controller",
    mapping: partial.mapping ?? "standard",
    connected: partial.connected ?? true,
    axes: partial.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.has(i), value: pressed.has(i) ? 1 : 0 })),
  };
}

function snap(over: { buttons?: Partial<PadSnapshot["buttons"]>; axes?: Partial<PadSnapshot["axes"]>; triggers?: Partial<PadSnapshot["triggers"]> } = {}): PadSnapshot {
  return {
    id: "pad",
    buttons: { ...blankButtons(), ...over.buttons },
    axes: { lx: 0, ly: 0, rx: 0, ry: 0, ...over.axes },
    triggers: { lt: 0, rt: 0, ...over.triggers },
  };
}

const wedges = { lbWedges: 5, rbWedges: 8 };

function flags(over: Partial<RegionFlags> = {}): RegionFlags {
  return {
    modal: false, project: true, focus: null, view: "tracks", bottom: "effects",
    browserOpen: true, side: null, keysOpen: false, pluginOpen: false, ...over,
  };
}

describe("dead zone", () => {
  it("drops the slack around the centre and keeps full deflection", () => {
    expect(applyDeadzone(0.1)).toBe(0);
    expect(applyDeadzone(0.18)).toBe(0);
    expect(applyDeadzone(1)).toBe(1);
    expect(applyDeadzone(-1)).toBe(-1);
    expect(applyDeadzone(0.59)).toBeCloseTo(0.5);
  });

  it("ignores a stick inside the dead zone when resolving a frame", () => {
    const frame = resolveFrame(emptyMemory(), snap({ axes: { lx: 0.1, ly: 0, rx: -0.1, ry: 0 } }), 0, wedges);
    expect(frame.axes).toEqual({ lx: 0, ly: 0, rx: 0, ry: 0 });
  });
});

describe("wheel aiming", () => {
  it("numbers wedges clockwise from the top", () => {
    expect(wedgeIndex(0, -1, 4)).toBe(0);
    expect(wedgeIndex(1, 0, 4)).toBe(1);
    expect(wedgeIndex(0, 1, 4)).toBe(2);
    expect(wedgeIndex(-1, 0, 4)).toBe(3);
    expect(wedgeIndex(0, -1, 5)).toBe(0);
  });

  it("treats a short shoulder press as a tap", () => {
    const down = resolveFrame(emptyMemory(), snap({ buttons: { lb: true } }), 0, wedges);
    expect(down.events).toEqual([]);
    const up = resolveFrame(down.memory, snap(), 100, wedges);
    expect(up.events).toContainEqual({ type: "tap", button: "lb", layer: "bare" });
  });

  it("opens the wheel after the hold and confirms the aimed wedge", () => {
    let memory = emptyMemory();
    const held = snap({ buttons: { lb: true } });
    memory = resolveFrame(memory, held, 0, wedges).memory;
    const opened = resolveFrame(memory, held, 280, wedges);
    expect(opened.events).toContainEqual({ type: "wheel-open", which: "lb" });
    const aimed = resolveFrame(opened.memory, snap({ buttons: { lb: true }, axes: { lx: 1, ly: 0, rx: 0, ry: 0 } }), 300, { ...wedges, lbWedges: 4 });
    expect(aimed.wheel?.index).toBe(1);
    const confirmed = resolveFrame(aimed.memory, snap({ axes: { lx: 1, ly: 0, rx: 0, ry: 0 } }), 400, { ...wedges, lbWedges: 4 });
    expect(confirmed.events).toContainEqual({ type: "wheel-confirm", which: "lb", index: 1 });
    expect(confirmed.events.some((event) => event.type === "tap")).toBe(false);
  });

  it("cancels the wheel when the stick is released in the centre", () => {
    let memory = resolveFrame(emptyMemory(), snap({ buttons: { lb: true } }), 0, wedges).memory;
    memory = resolveFrame(memory, snap({ buttons: { lb: true } }), 280, wedges).memory;
    const up = resolveFrame(memory, snap(), 400, wedges);
    expect(up.events).toContainEqual({ type: "wheel-cancel", which: "lb" });
  });

  it("does not fire a face button while the wheel is open", () => {
    let memory = resolveFrame(emptyMemory(), snap({ buttons: { rb: true } }), 0, wedges).memory;
    memory = resolveFrame(memory, snap({ buttons: { rb: true } }), 280, wedges).memory;
    const frame = resolveFrame(memory, snap({ buttons: { rb: true, a: true } }), 300, wedges);
    expect(frame.events.some((event) => event.type === "face")).toBe(false);
  });
});

describe("layers", () => {
  it("rewrites the face buttons while a trigger is held", () => {
    const frame = resolveFrame(emptyMemory(), snap({ buttons: { lt: true, a: true } }), 0, wedges);
    expect(frame.layer).toBe("lt");
    expect(frame.events).toContainEqual({ type: "face", button: "a", layer: "lt" });
  });

  it("lets LT win when both triggers are down", () => {
    const frame = resolveFrame(emptyMemory(), snap({ buttons: { lt: true, rt: true } }), 0, wedges);
    expect(frame.layer).toBe("lt");
  });

  it("maps View to undo, LT+View to redo, and View+Menu to the map", () => {
    expect(resolveFrame(emptyMemory(), snap({ buttons: { back: true } }), 0, wedges).events).toContainEqual({ type: "global", id: "undo" });
    expect(resolveFrame(emptyMemory(), snap({ buttons: { back: true, lt: true } }), 0, wedges).events).toContainEqual({ type: "global", id: "redo" });
    const both = resolveFrame(emptyMemory(), snap({ buttons: { back: true, start: true } }), 0, wedges);
    expect(both.events).toContainEqual({ type: "global", id: "map" });
    expect(both.events.some((event) => event.type === "global" && event.id === "undo")).toBe(false);
  });
});

describe("which screen wins", () => {
  it("lets a dialog cover the mixer and the arrange view", () => {
    expect(pickRegion(flags({ modal: true, view: "mixer", bottom: "editor" }))).toBe("modal");
  });

  it("keeps the tracks page while the effects dock is open", () => {
    expect(pickRegion(flags({ bottom: "effects", pluginOpen: true }))).toBe("arrange");
  });

  it("follows an explicit focus when that screen is open", () => {
    expect(pickRegion(flags({ focus: "effects", bottom: "effects" }))).toBe("effects");
    expect(pickRegion(flags({ focus: "plugin", pluginOpen: true, bottom: "effects" }))).toBe("plugin");
    expect(pickRegion(flags({ focus: "arrange", bottom: "editor" }))).toBe("arrange");
  });

  it("uses the editor dock, the full mixer, or the welcome page as the default", () => {
    expect(pickRegion(flags({ bottom: "editor" }))).toBe("editor");
    expect(pickRegion(flags({ view: "mixer", bottom: "editor" }))).toBe("mixer");
    expect(pickRegion(flags({ project: false, bottom: null }))).toBe("welcome");
  });

  it("drops a focus whose screen has closed", () => {
    expect(pickRegion(flags({ focus: "browser", browserOpen: false }))).toBe("arrange");
  });
});

describe("standard mapping", () => {
  it("reads an Xbox-style pad and ignores one without a standard mapping", () => {
    const raw = readStandardPad([pad({ pressed: [0, 6], id: "Controller (Xbox)" })]);
    expect(raw?.buttons.a).toBe(true);
    expect(raw?.buttons.lt).toBe(true);
    expect(raw?.buttons.b).toBe(false);
    expect(readStandardPad([pad({ mapping: "", pressed: [0] })])).toBeNull();
    expect(readStandardPad([null])).toBeNull();
  });
});
