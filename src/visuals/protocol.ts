/** Messages from the Drift window to the visuals window. Times are epoch ms. */
export interface VisualTrack {
  id: string;
  name: string;
  color: string;
  type: string;
  /** Muted, or silenced by another track's solo. */
  silent: boolean;
}

export type VisualsMessage =
  | {
      t: 'state';
      tracks: VisualTrack[];
      bpm: number;
      playing: boolean;
      stepsPerBar: number;
      chord: string;
      /** Pitch classes of the current chord, root first. */
      chordPcs: number[];
    }
  | { t: 'note'; track: string; notes: number[]; vel: number; at: number; dur: number }
  | { t: 'step'; step: number; bar: number; at: number }
  | { t: 'chord'; name: string; pcs: number[]; at: number }
  | { t: 'cc'; track: string; cc: number; value: number }
  | { t: 'lfo'; track: string; value: number; at: number }
  | { t: 'hello' }
  | { t: 'bye' };

export const CHANNEL = 'drift-visuals';
export const VISUALS_HASH = '#visuals';
