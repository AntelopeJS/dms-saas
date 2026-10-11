import { describe, expect, it } from "vitest";
import { highlightParts } from "../frontend-vue/app/build/highlight";

describe("workspace switcher search highlight", () => {
  it("marks every case-insensitive occurrence of the query", () => {
    expect(highlightParts("Initech Inc", "in")).toEqual([
      { text: "In", isMatch: true },
      { text: "itech ", isMatch: false },
      { text: "In", isMatch: true },
      { text: "c", isMatch: false },
    ]);
  });

  it("leaves the text whole without a query or a match", () => {
    expect(highlightParts("Globex", "  ")).toEqual([
      { text: "Globex", isMatch: false },
    ]);
    expect(highlightParts("Globex", "wayne")).toEqual([
      { text: "Globex", isMatch: false },
    ]);
  });
});
