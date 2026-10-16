import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyTextEdit, textEdit } from "./collab";

describe("shared notes", () => {
  it("finds the single changed span", () => {
    expect(textEdit("hello world", "hello brave world")).toEqual({ index: 6, remove: 0, insert: "brave " });
    expect(textEdit("hello brave world", "hello world")).toEqual({ index: 6, remove: 6, insert: "" });
    expect(textEdit("abc", "abc")).toEqual({ index: 3, remove: 0, insert: "" });
    expect(textEdit("", "new")).toEqual({ index: 0, remove: 0, insert: "new" });
    expect(textEdit("aaa", "aaaa")).toEqual({ index: 3, remove: 0, insert: "a" });
  });

  it("keeps both people's edits when they type at the same time", () => {
    const a = new Y.Doc(), b = new Y.Doc();
    applyTextEdit(a.getText("notes"), "Verse: double the vocal\nChorus: add harmonies");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    applyTextEdit(a.getText("notes"), "Intro: filter sweep\nVerse: double the vocal\nChorus: add harmonies");
    applyTextEdit(b.getText("notes"), "Verse: double the vocal\nChorus: add harmonies and claps");

    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    const merged = "Intro: filter sweep\nVerse: double the vocal\nChorus: add harmonies and claps";
    expect(a.getText("notes").toString()).toBe(merged);
    expect(b.getText("notes").toString()).toBe(merged);
  });
});
