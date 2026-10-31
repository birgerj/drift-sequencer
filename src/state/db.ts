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
