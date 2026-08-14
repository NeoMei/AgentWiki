import { describe, expect, it } from "vitest";
import { canonicalBytes } from "./canonical.js";

const decoder = new TextDecoder();

describe("canonicalBytes", () => {
  it("sorts object keys by code point", () => {
    expect(decoder.decode(canonicalBytes({ b: 1, a: 2 }))).toBe('{"a":2,"b":1}');
  });

  it("escapes control characters minimally", () => {
    expect(decoder.decode(canonicalBytes({ x: "a\nb" }))).toBe('{"x":"a\\nb"}');
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalBytes({ x: Number.NaN })).toThrow();
    expect(() => canonicalBytes({ x: Number.POSITIVE_INFINITY })).toThrow();
  });

  it("rejects unpaired surrogates", () => {
    expect(() => canonicalBytes({ x: "\ud800" })).toThrow();
  });

  it("rejects cyclic structures", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => canonicalBytes(value)).toThrow();
  });

  it("rejects undefined", () => {
    expect(() => canonicalBytes({ x: undefined })).toThrow();
  });
});
