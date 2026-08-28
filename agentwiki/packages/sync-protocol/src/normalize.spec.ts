import { describe, expect, it } from "vitest";
import {
  normalizeMarkdown,
  normalizeSyncPath,
  parseBatchIndex,
  parseDecimalCount,
  parsePageLimit,
  pathKey,
  validatePortableDirectoryPath,
  validatePortableMarkdownPath,
  validatePortablePath,
} from "./index.js";

describe("normalization and parsing", () => {
  it("normalizes CRLF and CR to LF", () => {
    expect(normalizeMarkdown("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("normalizes path segments to NFC", () => {
    expect(normalizeSyncPath("café/file.md")).toBe("café/file.md");
  });

  it("pathKey folds case", () => {
    expect(pathKey("Guide.md")).toBe("guide.md");
  });

  it("validates portable path", () => {
    expect(validatePortablePath("a/b.md").path).toBe("a/b.md");
    expect(() => validatePortablePath("/abs.md")).toThrow();
    expect(() => validatePortablePath("CON.md")).toThrow();
    expect(() => validatePortablePath("trailing.md ")).toThrow();
    expect(() => validatePortablePath("noext")).toThrow();
  });

  it("validates portable directory paths without requiring Markdown", () => {
    expect(validatePortableDirectoryPath("pages/项目")).toEqual({
      path: "pages/项目",
      key: "pages/项目",
    });
    expect(validatePortableMarkdownPath("pages/项目.md")).toEqual({
      path: "pages/项目.md",
      key: "pages/项目.md",
    });
    expect(validatePortableDirectoryPath("Cafe\u0301")).toEqual({
      path: "Café",
      key: "café",
    });
    expect(validatePortableDirectoryPath("Straße").key).toBe("strasse");
    expect(() => validatePortableMarkdownPath("pages/项目")).toThrow(/\.md/);
  });

  it("rejects non-portable directory segments and byte-length overflows", () => {
    for (const value of [
      "CON", "aux.txt", "a\u0000b", ".", "..", "a//b", "/a", "a\\b", "name.", "name ",
    ]) {
      expect(() => validatePortableDirectoryPath(value)).toThrow();
    }
    expect(() => validatePortableDirectoryPath("a".repeat(256))).toThrow(/255/);
    expect(() => validatePortableDirectoryPath("a/".repeat(512) + "a")).toThrow(/1024/);
  });

  it("parses canonical decimals", () => {
    expect(parseDecimalCount("0")).toBe(0n);
    expect(parseDecimalCount("9223372036854775807")).toBe(9223372036854775807n);
    expect(() => parseDecimalCount("01")).toThrow();
    expect(() => parseDecimalCount("-1")).toThrow();
  });

  it("parses batch index and page limit strictly", () => {
    expect(parseBatchIndex("0")).toBe(0);
    expect(parseBatchIndex("12")).toBe(12);
    expect(() => parseBatchIndex("01")).toThrow();
    expect(parsePageLimit("1")).toBe(1);
    expect(parsePageLimit("200")).toBe(200);
    expect(() => parsePageLimit("0")).toThrow();
    expect(() => parsePageLimit("201")).toThrow();
  });
});
