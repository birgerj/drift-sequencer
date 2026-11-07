const DB_NAME = 'drift';
const DB_VERSION = 2;
export const PROJECTS_STORE = 'projects';
export const INSTRUMENTS_STORE = 'instruments';

let db: Promise<IDBDatabase> | undefined;

/** One IndexedDB database for the app; upgrades add stores per version. */
export function openDriftDb(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(PROJECTS_STORE)) d.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(INSTRUMENTS_STORE)) d.createObjectStore(INSTRUMENTS_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

/** Empty every store and forget all of Drift's local settings (`drift.*` in localStorage). */
export async function wipeAllData(): Promise<void> {
  const d = await openDriftDb();
  const stores = [...d.objectStoreNames];
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(stores, 'readwrite');
    for (const name of stores) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('drift.')) localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing stored there either.
  }
}
