import type { ComponentType } from 'preact';
import type { Pattern } from '../../core/pattern/pattern';
import type { TrackState } from '../../state/project';
import type { RackDevice } from '../../state/rack';
import { DeviceJacks, HarmonyTuner, LedLadder, VuMeters } from './hifi/HifiParts';
import { ScopeTrace, SliderSequencer, TideWave } from './parts/PatternDisplays';
import { currentTheme } from './theme';

/**
 * Slots: places in the UI where a theme may show its own component instead
 * of (or in addition to) the default. Missing entries fall back to the default.
 */
export interface SlotProps {
  /** Meters under the transport in the rail. */
  railMeters: Record<string, never>;
  /** Pattern display on a melodic track's Overview tab. */
  overviewPattern: { track: TrackState; pattern: Pattern };
  /** Hero at the top of the Harmony page. */
  harmonyHero: Record<string, never>;
  /** Decoration in each device card on the Devices page. */
  deviceDecor: { device: RackDevice };
}

export type SlotName = keyof SlotProps;
type SlotMap = { [K in SlotName]?: ComponentType<SlotProps[K]> };

const SLOTS: Record<string, SlotMap> = {
  hifi: { railMeters: VuMeters, overviewPattern: LedLadder, harmonyHero: HarmonyTuner, deviceDecor: DeviceJacks },
  modular: { overviewPattern: SliderSequencer, deviceDecor: DeviceJacks },
  tide: { overviewPattern: TideWave },
  phosphor: { overviewPattern: ScopeTrace },
};

/** The active theme's component for a slot, if it has one. */
export function slotComponent<K extends SlotName>(slot: K): ComponentType<SlotProps[K]> | undefined {
  return SLOTS[currentTheme().id]?.[slot] as ComponentType<SlotProps[K]> | undefined;
}
