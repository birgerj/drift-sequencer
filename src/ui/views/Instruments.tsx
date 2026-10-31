import { useMemo, useState } from 'preact/hooks';
import { convertMidiGuide, isTriggerCsv, parseCsv } from '../../core/instruments/midiGuide';
import type { MidiGuideDevice } from '../../io/midiGuideClient';
import { Card, Icon } from '../components/controls';
import { useStore } from '../store';
import { MyDevices } from './MyDevices';

export function Instruments() {
  const s = useStore();
  const [devices, setDevices] = useState<MidiGuideDevice[] | undefined>();
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | undefined>();
  const installed = new Set(s.instruments.map((i) => i.definition.id));

  const browse = async (force = false) => {
    setLoading(true);
    try {
      setDevices(await s.midiGuide.listDevices(force));
    } catch (e) {
      s.showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!devices) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return devices.filter((d) => terms.every((t) => `${d.manufacturer} ${d.device}`.toLowerCase().includes(t))).slice(0, 60);
  }, [devices, query]);

  const importDevice = async (d: MidiGuideDevice) => {
    setBusy(d.path);
    try {
      await s.importInstrument(await s.midiGuide.fetchDefinition(d));
    } catch (e) {
      s.showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const importFiles = async (files: FileList) => {
    const texts = await Promise.all([...files].map(async (f) => ({ name: f.name, text: await f.text() })));
    const triggers = texts.filter((t) => isTriggerCsv(parseCsv(t.text)));
    const devicesCsv = texts.filter((t) => !triggers.includes(t));
    if (devicesCsv.length === 0) {
      s.showToast('Select the device CSV (optionally together with its .triggers.csv).');
      return;
    }
    for (const d of devicesCsv) {
      const base = d.name.replace(/\.csv$/i, '');
      const match = triggers.find((t) => t.name.replace(/\.triggers\.csv$/i, '') === base) ?? (devicesCsv.length === 1 ? triggers[0] : undefined);
      try {
        await s.importInstrument(convertMidiGuide(d.text, match?.text));
      } catch (e) {
        s.showToast(`${d.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  return (
    <div class="page">
      <div class="page-head">
        <button type="button" class="ghost" onClick={() => s.go({ name: 'performance' })}>
          <Icon name="back" /> Performance
        </button>
        <h1>Devices</h1>
      </div>

      <MyDevices />

      <div class="editor-grid">
        <div class="col wide">
          <Card
            title="midi.guide library"
            actions={
              devices ? (
                <button type="button" onClick={() => void browse(true)} aria-label="Reload device list">
                  <Icon name="refresh" />
                </button>
              ) : undefined
            }
          >
            {!devices && (
              <div class="empty">
                <p>
                  Browse CC maps for hundreds of synths and drum machines from midi.guide and import them with one tap.
                </p>
                <button type="button" class="primary" disabled={loading} onClick={() => void browse()}>
                  {loading ? 'Loading…' : 'Browse midi.guide'}
                </button>
              </div>
            )}
            {devices && (
              <>
                <input
                  type="search"
                  class="search"
                  placeholder={`Search ${devices.length} devices, e.g. “korg minilogue”`}
                  aria-label="Search devices"
                  value={query}
                  onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                />
                <ul class="device-list">
                  {filtered.map((d) => {
                    const id = `${d.manufacturer} ${d.device}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                    const isInstalled = installed.has(id);
                    return (
                      <li>
                        <div>
                          <b>{d.device}</b>
                          <span class="hint">
                            {d.manufacturer}
                            {d.hasTriggers ? ' · note map' : ''}
                          </span>
                        </div>
                        <button type="button" disabled={busy === d.path} aria-pressed={isInstalled} onClick={() => void importDevice(d)}>
                          {busy === d.path ? 'Importing…' : isInstalled ? (
                            <>
                              <Icon name="check" /> Update
                            </>
                          ) : (
                            <>
                              <Icon name="download" /> Import
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {filtered.length === 0 && <p class="hint">No devices match “{query}”.</p>}
              </>
            )}
            <p class="hint">
              Data: <a href="https://midi.guide" target="_blank" rel="noopener">midi.guide</a> by Pencil Research, CC BY-SA 4.0.
            </p>
          </Card>
        </div>

        <div class="col">
          <Card title="Installed definitions">
            <ul class="device-list">
              {s.instruments.map((i) => (
                <li>
                  <div>
                    <b>{i.definition.device}</b>
                    <span class="hint">
                      {i.definition.manufacturer} · {i.definition.params.length} params
                      {i.definition.triggers.length ? ` · ${i.definition.triggers.length} notes` : ''}
                      {i.builtIn ? ' · built-in' : ''}
                    </span>
                  </div>
                  {!i.builtIn && (
                    <button type="button" class="square" aria-label={`Remove ${i.definition.device}`} onClick={() => void s.removeInstrument(i.definition.id)}>
                      <Icon name="trash" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Import from file">
            <p class="hint">Select a midi.guide device CSV, optionally together with its .triggers.csv.</p>
            <label class="button">
              <Icon name="upload" /> Choose CSV files
              <input
                type="file"
                accept=".csv,text/csv"
                multiple
                class="sr-only"
                onChange={(e) => {
                  const files = (e.target as HTMLInputElement).files;
                  if (files?.length) void importFiles(files);
                  (e.target as HTMLInputElement).value = '';
                }}
              />
            </label>
          </Card>
        </div>
      </div>
    </div>
  );
}
