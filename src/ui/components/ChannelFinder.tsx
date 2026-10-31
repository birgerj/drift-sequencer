import { useEffect, useRef, useState } from 'preact/hooks';
import type { RackDevice } from '../../state/rack';
import { useStore } from '../store';
import { Icon } from './controls';

/**
 * Plays a short figure on channels 1–16, one after another, showing which
 * channel is sounding. When the synth plays, tap "That one!" to use it.
 */
export function ChannelFinder({ device, onClose }: { device: RackDevice; onClose: () => void }) {
  const s = useStore();
  const [channel, setChannel] = useState(0);
  const [running, setRunning] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!running) return;
    const next = channel >= 16 ? 1 : channel + 1;
    timer.current = setTimeout(
      () => {
        setChannel(next);
        void s.testDevice(device.id, next);
      },
      channel === 0 ? 100 : 1100,
    );
    return () => clearTimeout(timer.current);
  }, [channel, running]);

  const choose = () => {
    setRunning(false);
    if (channel > 0) {
      s.updateDevice(device.id, { channel });
      s.showToast(`${device.name} now uses channel ${channel}.`);
    }
    onClose();
  };

  return (
    <div class="channel-finder" role="group" aria-label={`Find the channel for ${device.name}`}>
      <div class="finder-channels" aria-live="polite">
        {Array.from({ length: 16 }, (_, i) => (
          <span class={`finder-ch ${i + 1 === channel ? 'on' : ''}`}>{i + 1}</span>
        ))}
      </div>
      <p class="hint">
        Listen to {device.name}. Playing on channel <b>{channel || '…'}</b>. Tap the button as soon as it sounds.
      </p>
      <div class="row gap-s wrap">
        <button type="button" class="primary" onClick={choose} disabled={channel === 0}>
          <Icon name="check" /> That one! (channel {channel || '…'})
        </button>
        <button type="button" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : 'Continue'}
        </button>
        <button
          type="button"
          class="ghost"
          onClick={() => {
            setRunning(false);
            onClose();
          }}
        >
          <Icon name="close" /> Cancel
        </button>
      </div>
      <p class="hint">
        Nothing on any channel? Check the synth's MIDI receive channel is not OFF, that it accepts MIDI over USB, and that its
        volume is up.
      </p>
    </div>
  );
}
