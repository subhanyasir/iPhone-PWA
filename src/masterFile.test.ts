import { describe, expect, it, vi } from "vitest";
import { parseMasterNumberLine, processMasterFile } from "./masterFile";

describe("master number file import", () => {
  it("normalizes formatted phone numbers and skips non-number lines", () => {
    expect(parseMasterNumberLine("\uFEFF+39 300-123 4567")).toBe("393001234567");
    expect(parseMasterNumberLine('"393001234567"')).toBe("393001234567");
    expect(parseMasterNumberLine("phone_number")).toBeUndefined();
    expect(parseMasterNumberLine("")).toBeUndefined();
  });

  it("streams line-delimited numbers in bounded batches", async () => {
    const file = new File(["393001234567\r\ninvalid\n+39 300 1234568"], "master.txt");
    const batches: string[][] = [];
    const progress: number[] = [];
    const result = await processMasterFile(
      file,
      async (batch) => { batches.push(batch); },
      (bytesRead) => { progress.push(bytesRead); },
      1
    );
    expect(result).toEqual({ valid: 2, invalid: 1 });
    expect(batches).toEqual([["393001234567"], ["393001234568"]]);
    expect(progress.at(-1)).toBe(file.size);
  });

  it("does not accumulate an entire file before writing", async () => {
    const file = new File(["393001234561\n393001234562\n393001234563\n393001234564\n393001234565"], "master.txt");
    const batchSizes: number[] = [];
    await processMasterFile(file, async (batch) => {
      batchSizes.push(batch.length);
    }, vi.fn(), 2);
    expect(batchSizes).toEqual([2, 2, 1]);
  });
});
