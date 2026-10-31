import type { InstrumentDefinition } from '../core/instruments/instrument';
import hydrasynth from '../core/instruments/data/asm-hydrasynth.json';
import wavestate from '../core/instruments/data/korg-wavestate.json';
import tb03 from '../core/instruments/data/roland-tb-03.json';
import tr8s from '../core/instruments/data/roland-tr-8s.json';
import { openDriftDb, INSTRUMENTS_STORE } from './db';

export interface InstalledInstrument {
  definition: InstrumentDefinition;
  /** Built-ins ship with the app and can't be removed. */
  builtIn: boolean;
  importedAt?: string;
}

export const BUILT_IN_INSTRUMENTS: InstrumentDefinition[] = [hydrasynth, wavestate, tb03, tr8s] as InstrumentDefinition[];

export interface InstrumentStore {
  all(): Promise<InstrumentDefinition[]>;
  put(def: InstrumentDefinition): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * Built-in definitions plus the ones the user imported. An imported
 * definition with the same id as a built-in replaces it.
 */
export class InstrumentLibrary {
  constructor(private readonly store: InstrumentStore) {}

  async list(): Promise<InstalledInstrument[]> {
    const imported = await this.store.all();
    const importedIds = new Set(imported.map((d) => d.id));
    const builtIns = BUILT_IN_INSTRUMENTS.filter((d) => !importedIds.has(d.id)).map((definition) => ({
      definition,
      builtIn: true,
    }));
    const user = imported.map((definition) => ({ definition, builtIn: false }));
    return [...builtIns, ...user].sort((a, b) =>
      `${a.definition.manufacturer} ${a.definition.device}`.localeCompare(
        `${b.definition.manufacturer} ${b.definition.device}`,
      ),
    );
  }

  async get(id: string): Promise<InstrumentDefinition | undefined> {
    return (await this.list()).find((i) => i.definition.id === id)?.definition;
  }

  async import(def: InstrumentDefinition): Promise<void> {
    validateDefinition(def);
    await this.store.put(def);
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id);
  }
}

export function validateDefinition(def: InstrumentDefinition): void {
  if (!def.id || !def.manufacturer || !def.device) throw new Error('Definition needs id, manufacturer and device.');
  if (!Array.isArray(def.params) || !Array.isArray(def.triggers)) throw new Error('Definition needs params and triggers.');
  if (def.params.length === 0 && def.triggers.length === 0) throw new Error('Definition has no parameters or notes.');
}

export class MemoryInstrumentStore implements InstrumentStore {
  private items = new Map<string, InstrumentDefinition>();
  async all() {
    return [...this.items.values()];
  }
  async put(def: InstrumentDefinition) {
    this.items.set(def.id, def);
  }
  async remove(id: string) {
    this.items.delete(id);
  }
}

export class IndexedDbInstrumentStore implements InstrumentStore {
  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDriftDb();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction(INSTRUMENTS_STORE, mode).objectStore(INSTRUMENTS_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async all(): Promise<InstrumentDefinition[]> {
    return this.run<InstrumentDefinition[]>('readonly', (s) => s.getAll());
  }

  async put(def: InstrumentDefinition): Promise<void> {
    await this.run('readwrite', (s) => s.put(def));
  }

  async remove(id: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(id));
  }
}
