import { describe, expect, it } from "vitest";
import { defaultMixName } from "./ExportDialog";

describe("export naming", () => {
  it("adds one editable Studio 4000 mix suffix", () => {
    expect(defaultMixName("My Song")).toBe("My Song_4kmix");
    expect(defaultMixName("My Song_4kmix")).toBe("My Song_4kmix");
    expect(defaultMixName("  ")).toBe("Mix_4kmix");
  });
});
