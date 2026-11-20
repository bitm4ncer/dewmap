import type { Bbox, BusNetwork } from "./busRoutes";

/**
 * IndexedDB persistence for bus networks.
 *
 * localStorage is a poor fit: a real city cell is several megabytes and
 * the 5 MB quota (and the old 1.8 MB self-imposed cap) silently dropped
 * exactly the data that makes a warm start useful. IndexedDB stores the
 * GeoJSON as structured objects without a JSON string, so the same quota
 * goes much further.
 */

const DB_NAME = "kugelmaps-bus-cache";
const DB_VERSION = 1;
const STORE = "networks";

export interface StoredBusNetwork {
  key: string;
  at: number;
  bbox: Bbox;
  data: BusNetwork;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

/** All persisted cells, newest first. Never throws. */
export async function readBusCache(): Promise<StoredBusNetwork[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () =>
        resolve(
          (request.result as StoredBusNetwork[]).sort((a, b) => b.at - a.at),
        );
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Persist one cell without rewriting the rest of the cache. */
export async function saveBusCacheEntry(entry: StoredBusNetwork): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Remove evicted cells from persistence. Never throws. */
export async function deleteBusCacheEntries(
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const key of keys) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Replace the persisted set. Used for the one-time legacy migration. */
export async function writeBusCache(entries: StoredBusNetwork[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      for (const entry of entries) store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
