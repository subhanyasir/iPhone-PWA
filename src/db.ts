import type { GenerationSession, GeneratorSettings, NumberEntry } from "./types";

const DB_NAME = "italian-number-generator";
const DB_VERSION = 2;
const DEFAULT_SETTINGS: GeneratorSettings = {
  countryCode: "39",
  quantity: 1000,
  batchSize: 500,
  exportFormat: "TXT"
};

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("sessions")) {
        const sessions = database.createObjectStore("sessions", { keyPath: "id" });
        sessions.createIndex("createdAt", "createdAt");
      }
      if (!database.objectStoreNames.contains("entries")) {
        const entries = database.createObjectStore("entries", { keyPath: "id", autoIncrement: true });
        entries.createIndex("sessionId", "sessionId");
        entries.createIndex("sessionEntry", ["sessionId", "id"]);
        entries.createIndex("number", "number");
      }
      if (!database.objectStoreNames.contains("settings")) database.createObjectStore("settings", { keyPath: "key" });
      if (!database.objectStoreNames.contains("masterNumbers")) {
        database.createObjectStore("masterNumbers", { keyPath: "number" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local storage."));
    request.onblocked = () => reject(new Error("Close other open app tabs to finish the local database update."));
  });
  return databasePromise;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("A local database operation failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The local database operation was cancelled."));
  });
}

export async function getSettings(): Promise<GeneratorSettings> {
  const database = await openDatabase();
  const tx = database.transaction("settings", "readonly");
  const request = tx.objectStore("settings").get("generator");
  const result = await new Promise<{ key: string; value: GeneratorSettings } | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (!result?.value) return DEFAULT_SETTINGS;
  return {
    countryCode: result.value.countryCode,
    quantity: result.value.quantity,
    batchSize: result.value.batchSize,
    exportFormat: result.value.exportFormat
  };
}

export async function saveSettings(settings: GeneratorSettings): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction("settings", "readwrite");
  tx.objectStore("settings").put({ key: "generator", value: settings });
  await transactionDone(tx);
}

export async function createSession(session: GenerationSession): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction("sessions", "readwrite");
  tx.objectStore("sessions").add(session);
  await transactionDone(tx);
}

export async function updateSession(session: GenerationSession): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction("sessions", "readwrite");
  tx.objectStore("sessions").put(session);
  await transactionDone(tx);
}

export async function getSessions(): Promise<GenerationSession[]> {
  const database = await openDatabase();
  const tx = database.transaction("sessions", "readonly");
  const request = tx.objectStore("sessions").index("createdAt").openCursor(null, "prev");
  const sessions: GenerationSession[] = [];
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      sessions.push(cursor.value as GenerationSession);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  return sessions;
}

export async function saveBatch(
  sessionId: string,
  numbers: string[]
): Promise<{ inserted: number; skipped: number }> {
  const database = await openDatabase();
  const tx = database.transaction("entries", "readwrite");
  const store = tx.objectStore("entries");
  const numberIndex = store.index("number");
  const createdAt = Date.now();
  let inserted = 0;
  let skipped = 0;
  const seen = new Set<string>();

  for (const number of numbers) {
    if (seen.has(number)) {
      skipped += 1;
      continue;
    }
    seen.add(number);
    const lookup = numberIndex.get(number);
    lookup.onsuccess = () => {
      if (lookup.result) {
        skipped += 1;
        return;
      }
      const request = store.add({ sessionId, number, createdAt } satisfies NumberEntry);
      request.onsuccess = () => { inserted += 1; };
    };
  }
  await transactionDone(tx);
  return { inserted, skipped };
}

export async function countEntries(): Promise<number> {
  const database = await openDatabase();
  const tx = database.transaction("entries", "readonly");
  const result = await new Promise<number>((resolve, reject) => {
    const request = tx.objectStore("entries").count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return result;
}

export async function countLegacyMasterNumbers(): Promise<number> {
  const database = await openDatabase();
  const tx = database.transaction("masterNumbers", "readonly");
  const done = transactionDone(tx);
  const request = tx.objectStore("masterNumbers").count();
  const count = await new Promise<number>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not count the old local master."));
  });
  await done;
  return count;
}

export async function clearLegacyMasterNumbers(): Promise<number> {
  const database = await openDatabase();
  const tx = database.transaction("masterNumbers", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("masterNumbers");
  const request = store.count();
  const clearedCount = new Promise<number>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not count the old local master."));
  });
  store.clear();
  const [count] = await Promise.all([clearedCount, done]);
  return count;
}

export async function getSessionEntryCount(sessionId: string): Promise<number> {
  const database = await openDatabase();
  const tx = database.transaction("entries", "readonly");
  const result = await new Promise<number>((resolve, reject) => {
    const request = tx.objectStore("entries").index("sessionId").count(IDBKeyRange.only(sessionId));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return result;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(["entries", "sessions"], "readwrite");
  const entries = tx.objectStore("entries");
  const cursorRequest = entries.index("sessionId").openCursor(IDBKeyRange.only(sessionId));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  tx.objectStore("sessions").delete(sessionId);
  await transactionDone(tx);
}

export async function deleteAllData(): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(["entries", "sessions"], "readwrite");
  tx.objectStore("entries").clear();
  tx.objectStore("sessions").clear();
  await transactionDone(tx);
}

export async function markInterruptedSessions(): Promise<void> {
  const sessions = await getSessions();
  const unfinished = sessions.filter((session) => session.status === "running");
  await Promise.all(unfinished.map((session) => updateSession({ ...session, status: "interrupted", updatedAt: Date.now() })));
}

export async function streamSession(
  sessionId: string,
  onChunk: (numbers: string[]) => Promise<void>,
  chunkSize = 1000
): Promise<number> {
  let count = 0;
  let lowerKey: IDBValidKey = [sessionId, 0];
  let exclusive = false;
  while (true) {
    const database = await openDatabase();
    const tx = database.transaction("entries", "readonly");
    const index = tx.objectStore("entries").index("sessionEntry");
    const range = exclusive
      ? IDBKeyRange.bound(lowerKey, [sessionId, Number.MAX_SAFE_INTEGER], true, false)
      : IDBKeyRange.bound(lowerKey, [sessionId, Number.MAX_SAFE_INTEGER]);
    const request = index.openCursor(range);
    const page = await new Promise<{ numbers: string[]; lastId?: number }>((resolve, reject) => {
      const numbers: string[] = [];
      let lastId: number | undefined;
      request.onerror = () => reject(request.error ?? new Error("Could not read the selected session."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve({ numbers, lastId });
          return;
        }
        numbers.push((cursor.value as NumberEntry).number);
        lastId = cursor.primaryKey as number;
        if (numbers.length >= chunkSize) resolve({ numbers, lastId });
        else cursor.continue();
      };
    });
    await transactionDone(tx);
    if (page.numbers.length === 0) break;
    await onChunk(page.numbers);
    count += page.numbers.length;
    if (page.numbers.length < chunkSize || page.lastId === undefined) break;
    lowerKey = [sessionId, page.lastId];
    exclusive = true;
  }
  return count;
}

export async function estimateStorage(): Promise<{ usage?: number; quota?: number }> {
  if (!navigator.storage?.estimate) return {};
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage, quota: estimate.quota };
}
