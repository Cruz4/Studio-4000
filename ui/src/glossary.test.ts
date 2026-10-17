import { describe, expect, it } from "vitest";
import { searchGlossary } from "./glossary";

describe("help search", () => {
  it("finds collaborate from the words people actually type", () => {
    const hits = searchGlossary("where is the collab button and how to do it");
    expect(hits[0]?.title).toBe("Collaborate");
    expect(hits.some((h) => h.title === "Collaborate")).toBe(true);
  });

  it("finds recording without matching every other page", () => {
    const hits = searchGlossary("how do I record");
    expect(hits[0]?.title).toBe("Record");
  });

  it("returns the whole glossary when the box is empty", () => {
    expect(searchGlossary("").length).toBeGreaterThan(30);
    expect(searchGlossary("the").length).toBeGreaterThan(30);
  });
});
