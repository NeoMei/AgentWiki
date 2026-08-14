import { describe, expect, it } from "vitest";
import { foldCase } from "./case-folding.js";

describe("foldCase", () => {
  it("folds sharp s to ss", () => {
    expect(foldCase("Straße")).toBe("strasse");
  });

  it("folds dotted capital I to i + combining dot", () => {
    expect(foldCase("İ")).toBe("i\u0307");
  });

  it("keeps dotless i unchanged under default full folding", () => {
    // U+0131 only folds under Turkic (status T); default full folding is C+F.
    expect(foldCase("ı")).toBe("ı");
  });
});
