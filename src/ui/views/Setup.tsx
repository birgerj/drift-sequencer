import { useEffect, useMemo, useState } from 'preact/hooks';
import { DEVICE_ROLES, guessPorts, newDevice, suggestInstrument, type DeviceRole, type RackDevice } from '../../state/rack';
import { Card, Icon, Select, Stepper, Toggle } from '../components/controls';
import { useStore } from '../store';

interface Row {
  portName: string; // '' = not used
  channel: number;
  instrumentId: string;
  name: string;
}

const DEFAULT_CHANNEL: Record<DeviceRole, number> = { lead: 1, bass: 2, pad: 3, drums: 10 };

/**
 * One-screen setup: which port is your lead, bass, pad and drum machine?
 * Saves the answers as "My devices", used by every project and template.
 */
export function Setup() {
  const s = useStore();
  const instruments = s.instruments.map((i) => i.definition);
  const existing = (role: DeviceRole) => s.rack.devices.find((d) => d.roles.includes(role));

  const initial = useMemo(() => {
    const guess = guessPorts(s.ports);
    const rows = {} as Record<DeviceRole, Row>;
    for (const { role } of DEVICE_ROLES) {
      const d = existing(role);
      const portName = d?.portName ?? guess[role] ?? '';
      const suggestion = portName ? suggestInstrument(portName, instruments) : undefined;
      rows[role] = {
        portName,
        // Separate synths usually listen on channel 1 (drum machines on 10);
        // a synth shared between roles gets distinct channels.
        channel:
          d?.channel ??
          (role === 'drums' ? 10 : role !== 'lead' && portName && portName === guess.lead ? DEFAULT_CHANNEL[role] : 1),
        instrumentId: d?.instrumentId ?? suggestion?.id ?? '',
        name: d?.name ?? suggestion?.device ?? portName,
      };
    }
    return rows;
    // Recompute when ports appear (after connecting MIDI).
  }, [s.ports.join('|'), s.instruments.length]);

  const [rows, setRows] = useState(initial);
  const [clockRole, setClockRole] = useState<DeviceRole | ''>(
    (DEVICE_ROLES.find(({ role }) => existing(role)?.clock)?.role ?? (initial.drums.portName ? 'drums' : '')) as DeviceRole | '',
  );
  useEffect(() => {
    setRows(initial);
    // Ports often appear only after connecting: default the clock to the drum machine.
    setClockRole((c) => c || (initial.drums.portName ? 'drums' : ''));
  }, [initial]);

  const update = (role: DeviceRole, patch: Partial<Row>) =>
    setRows((r) => {
      const next = { ...r[role], ...patch };
      if (patch.portName !== undefined) {
        const suggestion = suggestInstrument(patch.portName, instruments);
        if (suggestion && !r[role].instrumentId) next.instrumentId = suggestion.id;
        if (!r[role].name || r[role].name === r[role].portName) next.name = suggestion?.device ?? patch.portName;
      }
      return { ...r, [role]: next };
    });

  const save = () => {
    // One rack device per port+channel; several roles can share it.
    const devices: RackDevice[] = [];
    for (const { role } of DEVICE_ROLES) {
      const row = rows[role];
      if (!row.portName) continue;
      const same = devices.find((d) => d.portName === row.portName && d.channel === row.channel);
      if (same) {
        same.roles.push(role);
        if (clockRole === role) same.clock = true;
        continue;
      }
      const prev = s.rack.devices.find((d) => d.portName === row.portName && d.channel === row.channel);
      const baseName = row.name || row.portName;
      // Same synth on another channel (multitimbral): make the names distinguishable.
      const sharesPort = devices.some((d) => d.portName === row.portName);
      devices.push(
        newDevice({
          ...(prev ? { id: prev.id } : {}),
          name: sharesPort && !prev ? `${baseName} · ch ${row.channel}` : prev?.name ?? baseName,
          portName: row.portName,
          channel: row.channel,
          ...(row.instrumentId ? { instrumentId: row.instrumentId } : {}),
          roles: [role],
          clock: clockRole === role,
        }),
      );
    }
    // Keep devices the wizard doesn't cover (added by hand, no role).
    const extra = s.rack.devices.filter((d) => d.roles.length === 0 && !devices.some((n) => n.id === d.id));
    s.setRack({ devices: [...devices, ...extra] }, true);
    s.showToast(`Saved ${devices.length} device${devices.length === 1 ? '' : 's'}. Every project and template now uses them.`);
    s.go({ name: 'performance' });
  };

  const portOptions = [
    { value: '', label: 'Not used' },
    ...[...new Set([...s.ports, ...DEVICE_ROLES.map(({ role }) => rows[role].portName).filter(Boolean)])].map((p) => ({
      value: p,
      label: s.ports.includes(p) ? p : `${p} (not connected)`,
    })),
  ];
  const instrumentOptions = [{ value: '', label: 'None' }, ...instruments.map((d) => ({ value: d.id, label: `${d.manufacturer} ${d.device}` }))];

  return (
    <div class="page">
      <div class="page-head">
        <button type="button" class="ghost" onClick={() => s.go({ name: 'performance' })}>
          <Icon name="back" /> Performance
        </button>
        <h1>Set up your gear</h1>
      </div>
      <p class="hint lead-hint">
        Tell Drift once which synth plays what. Every project and template then uses these devices, so switching templates
        never loses your setup.
      </p>

      {!s.midi.connected && (
        <Card>
          <div class="empty">
            <p>First connect your synths over USB and allow MIDI access.</p>
            <button type="button" class="primary" onClick={() => void s.connectMidi()}>
              Connect MIDI
            </button>
          </div>
        </Card>
      )}
      {s.midi.connected && s.ports.length === 0 && (
        <Card>
          <p class="warn">No MIDI outputs found. Check the USB cable and that the device is switched on.</p>
        </Card>
      )}

      <div class="setup-grid">
        {DEVICE_ROLES.map(({ role, label, hint }) => {
          const row = rows[role];
          return (
            <Card title={label} class={row.portName ? '' : 'unused'}>
              <p class="hint">{hint}</p>
              <Select label="MIDI port" value={row.portName} options={portOptions} onChange={(portName) => update(role, { portName })} />
              {row.portName && (
                <>
                  <div class="field">
                    <span class="field-label">Channel</span>
                    <Stepper label={`${label} channel`} value={row.channel} min={1} max={16} onChange={(channel) => update(role, { channel })} />
                  </div>
                  <div class="field">
                    <label class="field-label" for={`name-${role}`}>
                      Name
                    </label>
                    <input id={`name-${role}`} value={row.name} onInput={(e) => update(role, { name: (e.target as HTMLInputElement).value })} />
                  </div>
                  <Select label="Instrument (CC map)" value={row.instrumentId} options={instrumentOptions} onChange={(instrumentId) => update(role, { instrumentId })} />
                  <Toggle label="Send clock" description="MIDI clock + start/stop" checked={clockRole === role} onChange={(on) => setClockRole(on ? role : '')} />
                </>
              )}
            </Card>
          );
        })}
      </div>

      <div class="row gap-s wrap">
        <button type="button" class="primary big-action" onClick={save} disabled={!DEVICE_ROLES.some(({ role }) => rows[role].portName)}>
          <Icon name="check" /> Save devices
        </button>
        <button type="button" onClick={() => s.go({ name: 'instruments' })}>
          Find instrument definitions…
        </button>
      </div>
      <p class="hint">
        Lead and pad can share a synth: pick the same port with another channel (multitimbral) or the same channel. You can
        change everything later under Devices.
      </p>
    </div>
  );
}
