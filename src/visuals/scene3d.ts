/** Shared shape of the three.js scenes (Tunnel, Warp). */
export type RGB = [number, number, number];

/** What the visuals window hands a 3D scene every frame. */
export interface SceneInput {
  dt: number;
  /** Continuous beat count (quarter notes). */
  beats: number;
  playing: boolean;
  kick: number;
  snare: number;
  hat: number;
  energy: number;
  bass: number;
  pad: number;
  /** Chord colours from Drift (root, third, fifth), 0..1. */
  cols: RGB[];
  /** Drift's travel speed; 0.4 is the default cruising speed. */
  travelSpeed: number;
}

export interface Scene3D {
  readonly canvas: HTMLCanvasElement;
  /** Size in CSS pixels; ratio is device pixels per CSS pixel. */
  resize(w: number, h: number, ratio: number): void;
  render(input: SceneInput): void;
  /** A melodic note (lead or pad), placed in the world in the track's colour. pitch 0..1. */
  note(color: RGB, pitch: number, vel: number, durS: number): void;
  /** Overlay text the scene wants shown, or empty. */
  caption?(): string;
  /** Scene-specific controls shown in the HUD while this scene is active. */
  controls?(): SceneControl[];
  /** Toggle (boolean), choice (option value) or action (true) from the HUD. */
  setControl?(id: string, value: boolean | string): void;
}

/** A scene control: an on/off switch, a choice that cycles through options, or a one-shot action. */
export type SceneControl =
  | { kind: 'toggle'; id: string; label: string; title: string; value: boolean }
  | { kind: 'choice'; id: string; label: string; title: string; value: string; options: { value: string; label: string }[] }
  | { kind: 'action'; id: string; label: string; title: string };
