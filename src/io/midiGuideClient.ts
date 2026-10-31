import type { InstrumentDefinition } from '../core/instruments/instrument';
import { convertMidiGuide } from '../core/instruments/midiGuide';

export interface MidiGuideDevice {
  manufacturer: string;
  device: string;
  /** Path of the device CSV inside the repository. */
  path: string;
  hasTriggers: boolean;
}

const REPO = 'pencilresearch/midi';
const BRANCH = 'main';
const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const CACHE_KEY = 'drift.midiGuide.devices';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * Reads the midi.guide catalogue straight from GitHub. Both endpoints allow
 * cross-origin requests, so no backend is needed. The device list is one API
 * call (GitHub allows 60 per hour without login) and is cached for a day.
 */
export class MidiGuideClient {
  constructor(
    private readonly fetcher: Fetch = (url) => fetch(url),
    private readonly cache: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeLocalStorage(),
  ) {}

  async listDevices(force = false): Promise<MidiGuideDevice[]> {
    if (!force) {
      const cached = this.readCache();
      if (cached) return cached;
    }
    const res = await this.fetcher(TREE_URL);
    if (!res.ok) {
      throw new Error(
        res.status === 403
          ? 'GitHub rate limit reached (60 requests per hour). Try again later or import a CSV file.'
          : `Could not load the midi.guide device list (HTTP ${res.status}).`,
      );
    }
    const devices = parseTree(await res.text());
    this.writeCache(devices);
    return devices;
  }

  async fetchDefinition(device: MidiGuideDevice): Promise<InstrumentDefinition> {
    const params = await this.getText(device.path);
    const triggers = device.hasTriggers ? await this.getText(triggersPathOf(device.path)) : undefined;
    return convertMidiGuide(params, triggers);
  }

  private async getText(path: string): Promise<string> {
    const url = RAW_BASE + path.split('/').map(encodeURIComponent).join('/');
    const res = await this.fetcher(url);
    if (!res.ok) throw new Error(`Could not download ${path} (HTTP ${res.status}).`);
    return res.text();
  }

  private readCache(): MidiGuideDevice[] | undefined {
    try {
      const raw = this.cache?.getItem(CACHE_KEY);
      if (!raw) return undefined;
      const { at, devices } = JSON.parse(raw) as { at: number; devices: MidiGuideDevice[] };
      return Date.now() - at < CACHE_TTL_MS ? devices : undefined;
    } catch {
      return undefined;
    }
  }

  private writeCache(devices: MidiGuideDevice[]): void {
    try {
      this.cache?.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), devices }));
    } catch {
      /* cache is optional */
    }
  }
}

function triggersPathOf(path: string): string {
  return path.replace(/\.csv$/, '.triggers.csv');
}

/** Turn the GitHub tree listing into a sorted device list. */
export function parseTree(json: string): MidiGuideDevice[] {
  const tree = (JSON.parse(json) as { tree?: { path: string; type: string }[] }).tree ?? [];
  const paths = new Set(tree.filter((t) => t.type === 'blob').map((t) => t.path));
  const devices: MidiGuideDevice[] = [];
  for (const path of paths) {
    const parts = path.split('/');
    if (parts.length !== 2 || !path.endsWith('.csv') || path.endsWith('.triggers.csv')) continue;
    const [manufacturer, file] = parts as [string, string];
    devices.push({
      manufacturer,
      device: file.replace(/\.csv$/, ''),
      path,
      hasTriggers: paths.has(triggersPathOf(path)),
    });
  }
  return devices.sort((a, b) => `${a.manufacturer} ${a.device}`.localeCompare(`${b.manufacturer} ${b.device}`));
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
