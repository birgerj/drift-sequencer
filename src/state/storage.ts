import { openDriftDb, PROJECTS_STORE } from './db';
import { SCHEMA_VERSION, type ProjectState } from './project';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

/** Where projects live. IndexedDB in the browser; in-memory in tests. */
export interface ProjectRepository {
  list(): Promise<ProjectSummary[]>;
  load(id: string): Promise<ProjectState | undefined>;
  save(project: ProjectState): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Serialize for export (.json download) or storage. */
export function serializeProject(project: ProjectState): string {
  return JSON.stringify({ ...project, schemaVersion: SCHEMA_VERSION }, null, 2);
}

/** Parse, migrate and sanity-check a stored or imported project. */
export function deserializeProject(json: string): ProjectState {
  const raw: unknown = JSON.parse(json);
  if (!raw || typeof raw !== 'object') throw new Error('Not a project file');
  const migrated = migrate(raw as Record<string, unknown>);
  validate(migrated);
  return migrated;
}

type Migration = (p: Record<string, unknown>) => Record<string, unknown>;

/** migrations[n] upgrades a project from schema n to n + 1. */
const migrations: Record<number, Migration> = {
  // 1: (p) => ({ ...p, newField: defaultValue }),
};

function migrate(p: Record<string, unknown>): ProjectState {
  let version = typeof p.schemaVersion === 'number' ? p.schemaVersion : 1;
  if (version > SCHEMA_VERSION) throw new Error(`Project was saved by a newer version (schema ${version}).`);
  let current = p;
  while (version < SCHEMA_VERSION) {
    const m = migrations[version];
    if (!m) throw new Error(`No migration from schema ${version}`);
    current = m(current);
    version++;
  }
  return { ...current, schemaVersion: SCHEMA_VERSION } as unknown as ProjectState;
}

function validate(p: ProjectState): void {
  const problems: string[] = [];
  if (typeof p.id !== 'string') problems.push('id');
  if (typeof p.bpm !== 'number' || p.bpm < 20 || p.bpm > 300) problems.push('bpm');
  if (!p.key || typeof p.key.root !== 'number') problems.push('key');
  if (!Array.isArray(p.progression) || p.progression.length === 0) problems.push('progression');
  if (!Array.isArray(p.tracks)) problems.push('tracks');
  for (const t of p.tracks ?? []) {
    if (!t.generator?.type) problems.push(`track ${t.name ?? '?'}: generator`);
    if (!t.output || t.output.channel < 1 || t.output.channel > 16) problems.push(`track ${t.name ?? '?'}: channel`);
  }
  if (problems.length) throw new Error(`Invalid project: ${problems.join(', ')}`);
}

export class MemoryProjectRepository implements ProjectRepository {
  private store = new Map<string, string>();

  async list(): Promise<ProjectSummary[]> {
    return [...this.store.values()].map((s) => {
      const p = JSON.parse(s) as ProjectState;
      return { id: p.id, name: p.name, updatedAt: p.updatedAt };
    });
  }

  async load(id: string): Promise<ProjectState | undefined> {
    const s = this.store.get(id);
    return s ? deserializeProject(s) : undefined;
  }

  async save(project: ProjectState): Promise<void> {
    this.store.set(project.id, serializeProject(project));
  }

  async remove(id: string): Promise<void> {
    this.store.delete(id);
  }
}

const STORE = PROJECTS_STORE;

/** Browser storage; survives reloads, stays on this device. */
export class IndexedDbProjectRepository implements ProjectRepository {
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDriftDb();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async list(): Promise<ProjectSummary[]> {
    const rows = await this.tx<{ id: string; json: string }[]>('readonly', (s) => s.getAll());
    return rows
      .map((r) => JSON.parse(r.json) as ProjectState)
      .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async load(id: string): Promise<ProjectState | undefined> {
    const row = await this.tx<{ id: string; json: string } | undefined>('readonly', (s) => s.get(id));
    return row ? deserializeProject(row.json) : undefined;
  }

  async save(project: ProjectState): Promise<void> {
    const stamped = { ...project, updatedAt: new Date().toISOString() };
    await this.tx('readwrite', (s) => s.put({ id: project.id, json: serializeProject(stamped) }));
  }

  async remove(id: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(id));
  }
}

/** Small per-device app settings (last project, UI prefs) in localStorage. */
export interface AppSettings {
  lastProjectId?: string;
}

const SETTINGS_KEY = 'drift.settings';

export function loadSettings(): AppSettings {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as AppSettings;
  } catch {
    return {};
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable (private mode); settings are optional */
  }
}
