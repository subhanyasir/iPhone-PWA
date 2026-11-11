import { beforeAll, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import type { GenerationSession, GeneratorSettings } from "./types";
import { exportHeader, formatExportChunk } from "./exportFormat";

describe("local generation data workflow", () => {
  beforeAll(() => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  });

  it("persists settings and batches, deduplicates, streams pages, and deletes sessions", async () => {
    const database = await import("./db");
    const defaults = await database.getSettings();
    expect(defaults.countryCode).toBe("39");

    const settings: GeneratorSettings = { ...defaults, countryCode: "39", quantity: 1300, batchSize: 500 };
    await database.saveSettings(settings);
    expect(await database.getSettings()).toEqual(settings);

    const session: GenerationSession = {
      id: "workflow-test",
      createdAt: 1,
      updatedAt: 1,
      requested: 1300,
      generated: 0,
      countryCode: "39",
      batchSize: 500,
      avoidDuplicates: true,
      exportFormat: "TXT",
      status: "running"
    };
    await database.createSession(session);
    const numbers = Array.from({ length: 1300 }, (_, index) => `39${3_000_000_000 + index}`);
    expect(await database.importMasterBatch([numbers[0], numbers[1], numbers[1]])).toEqual({ inserted: 2, skipped: 1 });
    expect(await database.saveBatch(session.id, numbers)).toEqual({ inserted: 1298, skipped: 2 });
    expect(await database.saveBatch(session.id, numbers.slice(0, 3))).toEqual({ inserted: 0, skipped: 3 });
    expect(await database.countEntries()).toBe(1298);
    expect((await database.getMasterInfo()).count).toBe(1300);
    await database.markMasterInitialized("fixture.txt");
    expect((await database.getMasterInfo()).initialized).toBe(true);

    const chunkSizes: number[] = [];
    const streamed: string[] = [];
    const streamedCount = await database.streamSession(session.id, async (chunk) => {
      chunkSizes.push(chunk.length);
      streamed.push(...chunk);
    }, 500);
    expect(streamedCount).toBe(1298);
    expect(chunkSizes).toEqual([500, 500, 298]);
    expect(streamed[0]).toBe(numbers[2]);
    expect(streamed.at(-1)).toBe(numbers.at(-1));

    const masterPages: number[] = [];
    const masterValues: string[] = [];
    expect(await database.streamMaster(async (chunk) => {
      masterPages.push(chunk.length);
      masterValues.push(...chunk);
    }, 500)).toBe(1300);
    expect(masterPages).toEqual([500, 500, 300]);
    expect(masterValues).toContain(numbers[0]);

    await database.updateSession({ ...session, generated: streamedCount, status: "complete" });
    expect((await database.getSessions())[0].status).toBe("complete");
    await database.deleteSession(session.id);
    expect(await database.countEntries()).toBe(0);
    expect(await database.getSessions()).toHaveLength(0);
    expect((await database.saveBatch("later-session", [numbers[0]])).skipped).toBe(1);
    expect((await database.getMasterInfo()).count).toBe(1300);
  });

  it("formats TXT and CSV chunks while preserving the country prefix", () => {
    expect(exportHeader("TXT")).toBe("");
    expect(formatExportChunk(["393001234567", "393001234568"], "TXT")).toBe("393001234567\n393001234568\n");
    expect(exportHeader("CSV") + formatExportChunk(["393001234567", "393001234568"], "CSV"))
      .toBe('phone_number\r\n"393001234567"\r\n"393001234568"\r\n');
  });
});
