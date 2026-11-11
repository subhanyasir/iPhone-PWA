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

    const legacyDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("italian-number-generator", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const legacyTx = legacyDatabase.transaction("masterNumbers", "readwrite");
    legacyTx.objectStore("masterNumbers").put({ number: "393331234567" });
    await new Promise<void>((resolve, reject) => {
      legacyTx.oncomplete = () => resolve();
      legacyTx.onerror = () => reject(legacyTx.error);
      legacyTx.onabort = () => reject(legacyTx.error);
    });
    expect(await database.countLegacyMasterNumbers()).toBe(1);
    expect(await database.clearLegacyMasterNumbers()).toBe(1);
    expect(await database.countLegacyMasterNumbers()).toBe(0);
    legacyDatabase.close();

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
    expect(await database.saveBatch(session.id, numbers)).toEqual({ inserted: 1300, skipped: 0 });
    expect(await database.saveBatch(session.id, numbers.slice(0, 3))).toEqual({ inserted: 0, skipped: 3 });
    expect(await database.countEntries()).toBe(1300);

    const chunkSizes: number[] = [];
    const streamed: string[] = [];
    const streamedCount = await database.streamSession(session.id, async (chunk) => {
      chunkSizes.push(chunk.length);
      streamed.push(...chunk);
    }, 500);
    expect(streamedCount).toBe(1300);
    expect(chunkSizes).toEqual([500, 500, 300]);
    expect(streamed[0]).toBe(numbers[0]);
    expect(streamed.at(-1)).toBe(numbers.at(-1));

    await database.updateSession({ ...session, generated: streamedCount, status: "complete" });
    expect((await database.getSessions())[0].status).toBe("complete");
    await database.deleteSession(session.id);
    expect(await database.countEntries()).toBe(0);
    expect(await database.getSessions()).toHaveLength(0);
    expect(await database.saveBatch("later-session", [numbers[0]])).toEqual({ inserted: 1, skipped: 0 });
  });

  it("formats TXT and CSV chunks while preserving the country prefix", () => {
    expect(exportHeader("TXT")).toBe("");
    expect(formatExportChunk(["393001234567", "393001234568"], "TXT")).toBe("393001234567\n393001234568\n");
    expect(exportHeader("CSV") + formatExportChunk(["393001234567", "393001234568"], "CSV"))
      .toBe('phone_number\r\n"393001234567"\r\n"393001234568"\r\n');
  });
});
