import { describe, it, expect } from "vitest";
import { snapMarkers } from "./util";
describe("marker magnets", () => {
  it("catches the start within ten pixels", () => expect(snapMarkers(4.92, 2, [5], 100)).toBe(5));
  it("catches the end", () => expect(snapMarkers(2.93, 2, [5], 100)).toBe(3));
  it("releases past the marker", () => expect(snapMarkers(5.12, 2, [5], 100)).toBe(5.12));
  it("uses screen pixels at any zoom", () => expect(snapMarkers(4.6, 2, [5], 20)).toBe(5));
  it("does not create negative starts", () => expect(snapMarkers(.03, 2, [1], 100)).toBe(.03));
});
