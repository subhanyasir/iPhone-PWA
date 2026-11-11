import { describe, expect, it } from "vitest";
import { normalizeLine } from "./master-parser.mjs";

describe("master TXT line normalization", () => {
  it("preserves an international prefix while removing common phone formatting", () => {
    expect(normalizeLine('"+39 (333) 123-4567"')).toBe("393331234567");
    expect(normalizeLine("\uFEFF393331234567")).toBe("393331234567");
  });

  it("rejects malformed or out-of-range values", () => {
    expect(normalizeLine("")).toBeUndefined();
    expect(normalizeLine("not a phone number")).toBeUndefined();
    expect(normalizeLine("123456")).toBeUndefined();
    expect(normalizeLine("1234567890123456")).toBeUndefined();
  });
});
