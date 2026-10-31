import type { Pattern, PatternEvent, PitchSpec } from '../pattern/pattern';

export type PhraseRole = 'call' | 'response';
export type AnswerTransform = 'echo' | 'invert' | 'upThird' | 'downFourth' | 'retrograde';

/**
 * Call and response: two tracks take turns. Each cycle is two phrases long;
 * the caller plays the first phrase, the responder the second. A responder
 * can answer with its own pattern, or with the caller's phrase transformed.
 */
export interface PhraseSettings {
  role: PhraseRole;
  /** Phrase length in bars. */
  bars: number;
  answer?: { from: string; transform: AnswerTransform };
}

export const ANSWER_TRANSFORMS: { id: AnswerTransform; label: string }[] = [
  { id: 'echo', label: 'Echo' },
  { id: 'invert', label: 'Invert' },
  { id: 'upThird', label: 'Up a third' },
  { id: 'downFourth', label: 'Down a fourth' },
  { id: 'retrograde', label: 'Reverse' },
];

/** Whether a track with these settings plays in a given bar. */
export function phraseActive(phrase: PhraseSettings, bar: number): boolean {
  const bars = Math.max(1, phrase.bars);
  const pos = ((bar % (bars * 2)) + bars * 2) % (bars * 2);
  return phrase.role === 'call' ? pos < bars : pos >= bars;
}

/**
 * Events a responder plays at `globalStep`: the caller's events from the
 * matching moment of the previous phrase, transformed.
 */
export function answerEvents(
  source: Pattern,
  transform: AnswerTransform,
  globalStep: number,
  stepsPerBar: number,
  bars: number,
): PatternEvent[] {
  const window = Math.max(1, bars) * stepsPerBar;
  const pos = globalStep % (window * 2);
  if (pos < window) return [];
  const k = pos - window;
  const callStart = globalStep - pos;
  const sourceOffset = transform === 'retrograde' ? window - 1 - k : k;
  const local = (callStart + sourceOffset) % source.lengthSteps;
  return source.events.filter((e) => e.step === local).map((e) => ({ ...e, pitch: transformPitch(e.pitch, transform) }));
}

/**
 * The whole call+response cycle as one pattern, for display: silent during
 * the call, the transformed answer during the response.
 */
export function answerPattern(source: Pattern, transform: AnswerTransform, stepsPerBar: number, bars: number): Pattern {
  const window = Math.max(1, bars) * stepsPerBar;
  const events: PatternEvent[] = [];
  for (let step = window; step < window * 2; step++) events.push(...answerEvents(source, transform, step, stepsPerBar, bars).map((e) => ({ ...e, step })));
  return { lengthSteps: window * 2, events };
}

export function transformPitch(pitch: PitchSpec, transform: AnswerTransform): PitchSpec {
  switch (pitch.kind) {
    case 'degree':
    case 'keyDegree': {
      const d = pitch.degree;
      const degree =
        transform === 'invert' ? -d : transform === 'upThird' ? d + 2 : transform === 'downFourth' ? d - 3 : d;
      return { ...pitch, degree };
    }
    case 'chordTone': {
      if (transform === 'upThird') return { ...pitch, index: pitch.index + 1 };
      if (transform === 'downFourth') return { ...pitch, octave: pitch.octave - 1, index: pitch.index + 1 };
      if (transform === 'invert') return { ...pitch, index: Math.max(0, 2 - pitch.index) };
      return pitch;
    }
    default:
      return pitch;
  }
}
