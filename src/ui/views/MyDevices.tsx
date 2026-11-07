import { slotComponent } from "../theme/slots";
import { inputForDevice } from "../../state/rack";
import { useState } from "preact/hooks";
import { DEVICE_ROLES, devicesFromPorts, newDevice, suggestInstrument } from "../../state/rack";
import { ChannelFinder } from "../components/ChannelFinder";
import { Card, Icon, Select, Stepper, Toggle } from "../components/controls";
import { useStore } from "../store";
import { ThemePicker } from "../components/ThemePicker";

/** Manage the global device setup ("rack") shared by all projects. */
export function MyDevices() {
  const s = useStore();
  const [finding, setFinding] = useState<string | undefined>();
  const instruments = s.instruments.map((i) => i.definition);
  const instrumentOptions = [
    { value: "", label: "None" },
    ...instruments.map((d) => ({
      value: d.id,
      label: `${d.manufacturer} ${d.device}`,
    })),
  ];

  const add = () => {
    const used = new Set(s.rack.devices.map((d) => d.portName));
    const portName =
      s.hardwarePorts.find((p) => !used.has(p)) ?? s.hardwarePorts[0] ?? "New device";
    const suggestion = suggestInstrument(portName, instruments);
    s.setRack({
      devices: [
        ...s.rack.devices,
        newDevice({
          portName,
          name: suggestion?.device ?? portName,
          ...(suggestion ? { instrumentId: suggestion.id } : {}),
        }),
      ],
    });
  };

  const fresh = devicesFromPorts(s.hardwarePorts, s.rack, instruments);
  const addConnected = () => {
    s.setRack({ devices: [...s.rack.devices, ...fresh] }, true);
    s.showToast(
      `Added ${fresh.length} device${fresh.length === 1 ? "" : "s"}. Tracks now play them by role.`,
    );
  };

  return (
    <>
      <Card
        title="My devices"
        actions={
          s.midi.supported ? (
            <button type="button" onClick={add}>
              <Icon name="plus" /> Device
            </button>
          ) : undefined
        }
      >
        <p class="hint">
          External MIDI synths and drum machines. Every track can also play a
          built-in synth, picked on its Output tab.
        </p>
        {!s.midi.supported && (
          <p class="hint warn">
            This browser has no Web MIDI (Safari and every browser on iPhone
            and iPad), so it can't reach external synths. Use Chrome or Edge on
            a computer or Android for hardware; the built-in synths play
            everywhere.
          </p>
        )}
        {s.midi.supported && !s.midi.connected && (
          <div class="empty">
            <p>Connect your synths over USB, switch them on and allow MIDI access.</p>
            <button
              type="button"
              class="primary"
              onClick={() => void s.connectMidi()}
            >
              Connect MIDI
            </button>
          </div>
        )}
        {s.midi.connected && s.hardwarePorts.length === 0 && (
          <p class="warn">
            No MIDI outputs found. Check the USB cable and that the device is
            switched on.
          </p>
        )}
        {fresh.length > 0 && (
          <div class="empty">
            <p>
              Connected, not set up yet: {fresh.map((d) => d.portName).join(", ")}.
            </p>
            <button type="button" class="primary" onClick={addConnected}>
              <Icon name="plus" /> Add {fresh.length === 1 ? "it" : `all ${fresh.length}`}
            </button>
            <p class="small">
              Drift guesses what each one is used for; change it below.
            </p>
          </div>
        )}
        <div class="devices-list">
          {s.rack.devices.map((d) => {
            const connected = s.ports.includes(d.portName);
            const usedBy = s.project.tracks
              .filter((t) => t.deviceId === d.id)
              .map((t) => t.name);
            return (
              <div class="device-card" key={d.id}>
                <div class="row gap-s wrap">
                  <span
                    class={`dot ${connected ? "ok" : ""}`}
                    title={connected ? "Connected" : "Not connected"}
                  />
                  <input
                    class="device-name"
                    aria-label="Device name"
                    value={d.name}
                    onChange={(e) =>
                      s.updateDevice(d.id, {
                        name:
                          (e.target as HTMLInputElement).value || d.portName,
                      })
                    }
                  />
                  <div class="spacer" />
                  <button
                    type="button"
                    class="danger"
                    onClick={() => {
                      if (
                        confirm(
                          `Remove “${d.name}”? Tracks using it move to another device with the same role.`,
                        )
                      )
                        s.removeDevice(d.id);
                    }}
                  >
                    <Icon name="trash" /> Remove
                  </button>
                </div>
                {(() => {
                  const Decor = slotComponent("deviceDecor");
                  return Decor ? <Decor device={d} /> : null;
                })()}
                <div class="device-fields">
                  <Select
                    label="MIDI port"
                    value={d.portName}
                    options={[...new Set([d.portName, ...s.hardwarePorts])].map(
                      (p) => ({
                        value: p,
                        label: s.ports.includes(p) ? p : `${p} (not connected)`,
                      }),
                    )}
                    onChange={(portName) => s.updateDevice(d.id, { portName })}
                  />
                  <div class="field">
                    <span class="field-label">Channel</span>
                    <Stepper
                      label={`${d.name} channel`}
                      value={d.channel}
                      min={1}
                      max={16}
                      onChange={(channel) => s.updateDevice(d.id, { channel })}
                    />
                  </div>
                  <Select
                    label="Knobs in (MIDI input)"
                    value={d.inputName ?? ""}
                    options={[
                      {
                        value: "",
                        label: `Auto${inputForDevice({ ...d, inputName: undefined }, s.inputs) ? ` · ${inputForDevice({ ...d, inputName: undefined }, s.inputs)}` : " · none found"}`,
                      },
                      ...[
                        ...new Set([
                          ...(d.inputName && d.inputName !== "off"
                            ? [d.inputName]
                            : []),
                          ...s.inputs,
                        ]),
                      ].map((i) => ({
                        value: i,
                        label: s.inputs.includes(i)
                          ? i
                          : `${i} (not connected)`,
                      })),
                      { value: "off", label: "Off" },
                    ]}
                    onChange={(inputName) =>
                      s.updateDevice(d.id, {
                        inputName: inputName || undefined,
                      })
                    }
                  />
                  <Select
                    label="Instrument (CC map)"
                    value={d.instrumentId ?? ""}
                    options={instrumentOptions}
                    onChange={(id) =>
                      s.updateDevice(d.id, { instrumentId: id || undefined })
                    }
                  />
                </div>
                <div class="field">
                  <span class="field-label">Used for (templates send these parts here)</span>
                  <div class="chips">
                    {DEVICE_ROLES.map(({ role, label }) => (
                      <button
                        type="button"
                        class="chip"
                        aria-pressed={d.roles.includes(role)}
                        onClick={() =>
                          s.updateDevice(d.id, {
                            roles: d.roles.includes(role)
                              ? d.roles.filter((r) => r !== role)
                              : [...d.roles, role],
                          })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <Toggle
                  label="Send clock"
                  description="MIDI clock + start/stop"
                  checked={d.clock}
                  onChange={(clock) => s.updateDevice(d.id, { clock })}
                />
                {usedBy.length > 0 && (
                  <p class="hint">In this project: {usedBy.join(", ")}</p>
                )}
                {finding === d.id ? (
                  <ChannelFinder
                    device={d}
                    onClose={() => setFinding(undefined)}
                  />
                ) : (
                  <div class="row gap-s wrap">
                    <button
                      type="button"
                      onClick={() => void s.testDevice(d.id)}
                    >
                      <Icon name="play" size={16} /> Test note
                    </button>
                    <button type="button" onClick={() => setFinding(d.id)}>
                      Find channel…
                    </button>
                    {(d.roles.includes("bass") ||
                      /tb-?03|td-?3|303/i.test(
                        `${d.instrumentId ?? ""} ${d.portName}`,
                      )) && (
                      <button
                        type="button"
                        onClick={() => void s.acidTest(d.id)}
                        title="Plain, accent, slide up, slide down with accent"
                      >
                        Acid test
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Appearance">
        <ThemePicker />
        <p class="hint">Shift+T cycles through the themes.</p>
      </Card>
    </>
  );
}
