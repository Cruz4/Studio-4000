// Modified for Studio 4000: regressions for selection at every viewport edge.
import { afterEach, describe, expect, it, vi } from "vitest";
import { edgeVelocity, startSelectionDrag } from "./selectionDrag";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("selection edge scrolling", () => {
  it("scrolls in all four directions and accelerates toward the edge", () => {
    expect(edgeVelocity(201, 200, 800)).toBeLessThan(0);
    expect(edgeVelocity(799, 200, 800)).toBeGreaterThan(0);
    expect(edgeVelocity(35, 34, 600)).toBeLessThan(0);
    expect(edgeVelocity(599, 34, 600)).toBeGreaterThan(0);
    expect(edgeVelocity(500, 200, 800)).toBe(0);
    expect(Math.abs(edgeVelocity(201, 200, 800))).toBeGreaterThan(Math.abs(edgeVelocity(230, 200, 800)));
  });

  function setup() {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    vi.spyOn(performance, "now").mockReturnValue(0);
    let next = 0, now = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++next, fn); return next; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const host = {
      clientWidth: 800, clientHeight: 600, scrollWidth: 2400, scrollHeight: 1800,
      scrollLeft: 300, scrollTop: 300,
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    } as unknown as HTMLElement;
    const event = (type: string, clientX: number, clientY: number, pointerId = 1) =>
      Object.assign(new Event(type, { cancelable: true }), { clientX, clientY, pointerId }) as PointerEvent;
    const advance = () => {
      const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) throw new Error("No animation frame was scheduled");
      frames.delete(entry[0]);
      entry[1](now += 16);
    };
    return { target, host, event, advance, frames };
  }

  it("keeps scrolling and updating selection while a held pointer stays at an edge", () => {
    const { target, host, event, advance, frames } = setup();
    const move = vi.fn(), end = vi.fn();
    const cleanup = startSelectionDrag(event("pointerdown", 400, 250), host, () => 200, move, end);
    target.dispatchEvent(event("pointermove", 795, 595));
    advance();
    const first = [host.scrollLeft, host.scrollTop];
    advance();
    expect(host.scrollLeft).toBeGreaterThan(first[0]);
    expect(host.scrollTop).toBeGreaterThan(first[1]);
    expect(move).toHaveBeenCalledTimes(2);
    target.dispatchEvent(event("pointerup", 795, 595));
    expect(end.mock.calls[0][1]).toBe(false);
    expect(frames.size).toBe(0);
    cleanup();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("scrolls left and up without moving the original content anchor", () => {
    const { target, host, event, advance } = setup();
    const move = vi.fn();
    const cleanup = startSelectionDrag(event("pointerdown", 400, 250), host, () => 200, move, vi.fn());
    target.dispatchEvent(event("pointermove", 201, 35));
    advance();
    expect(host.scrollLeft).toBeLessThan(300);
    expect(host.scrollTop).toBeLessThan(300);
    expect(move.mock.calls[0].slice(0, 2)).toEqual([-199, -215]);
    cleanup();
  });

  it("does not scroll a click or another pointer and cancels cleanly on focus loss", () => {
    const { target, host, event, advance, frames } = setup();
    const end = vi.fn();
    startSelectionDrag(event("pointerdown", 799, 599), host, () => 200, vi.fn(), end);
    target.dispatchEvent(event("pointermove", 0, 0, 2));
    advance();
    expect(host.scrollLeft).toBe(300);
    expect(host.scrollTop).toBe(300);
    target.dispatchEvent(new Event("blur"));
    expect(end.mock.calls[0][1]).toBe(true);
    expect(frames.size).toBe(0);
  });

  it("stops at content bounds and handles pointer cancellation", () => {
    const { target, host, event, advance, frames } = setup();
    host.scrollLeft = host.scrollTop = 1;
    const end = vi.fn();
    startSelectionDrag(event("pointerdown", 400, 250), host, () => 200, vi.fn(), end);
    target.dispatchEvent(event("pointermove", -50, -50));
    advance();
    expect(host.scrollLeft).toBe(0);
    expect(host.scrollTop).toBe(0);
    target.dispatchEvent(event("pointercancel", -50, -50));
    expect(end.mock.calls[0][1]).toBe(true);
    expect(frames.size).toBe(0);
  });
});
