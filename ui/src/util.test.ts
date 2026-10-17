import { describe, expect, it } from "vitest";
import type { Project } from "./types";
import { groupOrder, pluginDropIndex } from "./pluginReorder";
import { clipGainDbAt, dbToFader, faderToDb, formatBars, formatDb, formatRulerTime, formatTime, gridSeconds, meterPos, noteName, parseDb, rulerStep, secondsPerBar, shade, snap } from "./util";

const song = (bpm: number, timeSig: [number, number] = [4, 4]) => ({ bpm, timeSig }) as Project;

describe("musical time", () => {
  it("measures bars in any time signature", () => {
    expect(secondsPerBar(song(120))).toBeCloseTo(2);
    expect(secondsPerBar(song(120, [3, 4]))).toBeCloseTo(1.5);
    expect(secondsPerBar(song(120, [6, 8]))).toBeCloseTo(1.5);
    expect(secondsPerBar(null)).toBeCloseTo(2);
  });

  it("formats bar.beat.sixteenth", () => {
    expect(formatBars(0, song(120))).toBe("1.1.1");
    expect(formatBars(2, song(120))).toBe("2.1.1");
    expect(formatBars(2.625, song(120))).toBe("2.2.2");
    expect(formatBars(1.5, song(120, [3, 4]))).toBe("2.1.1");
    expect(formatBars(-3, song(120))).toBe("1.1.1");
  });

  it("snaps to the grid unless bypassed", () => {
    const p = song(120);
    expect(gridSeconds("1/2", p)).toBeCloseTo(1);
    expect(gridSeconds("beat", p)).toBeCloseTo(0.5);
    expect(gridSeconds("1/16", p)).toBeCloseTo(0.125);
    expect(gridSeconds("1/32", p)).toBeCloseTo(0.0625);
    expect(gridSeconds("1/64", p)).toBeCloseTo(0.03125);
    expect(gridSeconds("1/128", p)).toBeCloseTo(0.015625);
    expect(gridSeconds("bart", p)).toBeCloseTo(4 / 3);
    expect(gridSeconds("1/2t", p)).toBeCloseTo(2 / 3);
    expect(gridSeconds("1/4t", p)).toBeCloseTo(1 / 3);
    expect(gridSeconds("1/8t", p)).toBeCloseTo(1 / 6);
    expect(gridSeconds("1/16t", p)).toBeCloseTo(1 / 12);
    expect(gridSeconds("1/32t", p)).toBeCloseTo(1 / 24);
    expect(gridSeconds("1/64t", p)).toBeCloseTo(1 / 48);
    expect(snap(1.07, "beat", p)).toBeCloseTo(1);
    expect(snap(1.3, "beat", p)).toBeCloseTo(1.5);
    expect(snap(1.3, "bar", p)).toBeCloseTo(2);
    expect(snap(1.3, "beat", p, true)).toBeCloseTo(1.3);
    expect(snap(-0.2, "off", p)).toBe(0);
  });

  it("formats clock time", () => {
    expect(formatTime(65.5)).toBe("1:05.500");
    expect(formatTime(65.5, false)).toBe("1:05");
  });
});

describe("effect order", () => {
  it("lands on the effect you drag onto", () => {
    expect(pluginDropIndex(0, 1, true)).toBe(1);
    expect(pluginDropIndex(0, 2, true)).toBe(2);
    expect(pluginDropIndex(2, 0, false)).toBe(0);
    expect(pluginDropIndex(2, 1, false)).toBe(1);
    expect(pluginDropIndex(0, 1, false)).toBe(0);
    expect(pluginDropIndex(1, 1, true)).toBe(1);
  });

  it("moves a selection as one block", () => {
    expect(groupOrder(["a", "b", "c", "d"], ["a", "b"], 3, true)).toEqual(["c", "d", "a", "b"]);
    expect(groupOrder(["a", "b", "c", "d"], ["c", "d"], 0, false)).toEqual(["c", "d", "a", "b"]);
    expect(groupOrder(["a", "b", "c", "d"], ["a", "c"], 1, true)).toEqual(["b", "a", "c", "d"]);
    expect(groupOrder(["a", "b", "c", "d"], ["a", "b"], null, true)).toEqual(["c", "d", "a", "b"]);
    expect(groupOrder(["a", "b", "c", "d"], ["a", "b"], 0, false)).toBeNull();
  });
});

describe("levels", () => {
  it("gives +3 dB and -3 dB the same travel from 0", () => {
    const up = dbToFader(3) - dbToFader(0);
    const down = dbToFader(0) - dbToFader(-3);
    expect(up).toBeCloseTo(down, 5);
    expect(dbToFader(15) - dbToFader(0)).toBeCloseTo(dbToFader(0) - dbToFader(-15), 5);
    const step = dbToFader(0) - dbToFader(-5);
    expect(dbToFader(-5) - dbToFader(-10)).toBeCloseTo(step, 5);
    expect(dbToFader(10) - dbToFader(5)).toBeCloseTo(step, 5);
    expect(dbToFader(-24) - dbToFader(-36)).toBeCloseTo(dbToFader(-36) - dbToFader(-48), 5);
    expect(dbToFader(-24) - dbToFader(-36)).toBeCloseTo(step * (12 / 5), 4);
    expect(faderToDb(1)).toBeCloseTo(15);
    expect(faderToDb(0)).toBe(-100);
    expect(faderToDb(dbToFader(0))).toBeCloseTo(0);
  });

  it("round-trips fader positions", () => {
    for (const db of [-48, -24, -12, -6, -1, 0, 3, 6, 12, 15]) expect(faderToDb(dbToFader(db))).toBeCloseTo(db, 4);
  });

  it("maps meter levels monotonically into 0..1", () => {
    let last = -1;
    for (let db = -70; db <= 10; db += 5) {
      const pos = meterPos(db);
      expect(pos).toBeGreaterThanOrEqual(last);
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos).toBeLessThanOrEqual(1);
      last = pos;
    }
  });

  it("formats decibels for labels", () => {
    expect(formatDb(-120)).toBe("-∞");
    expect(formatDb(3.25)).toBe("+3.3");
    expect(formatDb(-6)).toBe("-6.0");
    expect(parseDb("+3")).toBe(3);
    expect(parseDb("-12.5 db")).toBe(-12.5);
    expect(parseDb("-∞")).toBe(-100);
    expect(parseDb("nope")).toBeNull();
  });
});

describe("ruler", () => {
  it("spaces the time labels out as the zoom changes", () => {
    expect(rulerStep(200)).toBe(0.5);
    expect(rulerStep(40)).toBe(2);
    expect(rulerStep(14)).toBe(5);
    expect(rulerStep(4)).toBe(30);
  });

  it("prints seconds like 0:05.0", () => {
    expect(formatRulerTime(5, 5)).toBe("0:05.0");
    expect(formatRulerTime(65, 5)).toBe("1:05.0");
    expect(formatRulerTime(0.5, 0.5)).toBe("0:00.5");
    expect(formatRulerTime(0.05, 0.01)).toBe("0:00.05");
  });
});

describe("clip gain", () => {
  it("holds the end points and blends between them", () => {
    const points: [number, number][] = [[1, -6], [3, 0]];
    expect(clipGainDbAt(undefined, 2)).toBe(0);
    expect(clipGainDbAt(points, 0)).toBe(-6);
    expect(clipGainDbAt(points, 2)).toBe(-3);
    expect(clipGainDbAt(points, 4)).toBe(0);
  });
});

describe("display helpers", () => {
  it("names MIDI notes", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(69)).toBe("A4");
  });

  it("turns hex colours into rgba", () => {
    expect(shade("#ff0080", 0.5)).toBe("rgba(255,0,128,0.5)");
    expect(shade("nope", 0.2)).toBe("rgba(124,92,255,0.2)");
  });
});
