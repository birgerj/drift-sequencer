/**
 * Theme registry. A theme is a set of values for the CSS custom properties
 * declared on :root in styles.css (the contract), plus optional fonts and
 * optional "extras": themed components that replace a default one in a slot.
 * Adding a theme = one CSS block under [data-theme="id"] + one entry here.
 */
export interface ThemeDef {
  id: string;
  name: string;
  description: string;
  /** Colours for the picker's preview chip. */
  swatch: [string, string, string];
  /** Google Fonts stylesheet; offline the CSS falls back to system fonts. */
  fontsHref?: string;
  /** <meta name="theme-color"> value. */
  chrome: string;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'studio',
    name: 'Studio',
    description: 'Dark and calm; colour comes from the tracks.',
    swatch: ['#0b0c0f', '#1a1d23', '#f5a524'],
    chrome: '#0b0c0f',
  },
  {
    id: 'hifi',
    name: 'Hi-Fi',
    description: 'Retro stereo tower: brushed aluminium, VFD displays, VU meters, walnut.',
    swatch: ['#c9ced3', '#060b0d', '#7ff6ff'],
    fontsHref: 'https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@500;600;700&family=Share+Tech+Mono&display=swap',
    chrome: '#1b1410',
  },
  {
    id: 'modular',
    name: 'Modular',
    description: 'Eurorack: black modules on rails, coloured knobs, jacks and fader sequencers.',
    swatch: ['#0c0c0d', '#1c1d1f', '#e9e6dc'],
    fontsHref: 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Share+Tech+Mono&display=swap',
    chrome: '#0c0c0d',
  },
  {
    id: 'tide',
    name: 'Tide',
    description: 'Deep night blue and frosted glass; patterns flow as waves.',
    swatch: ['#071a33', '#5eead4', '#c4b5fd'],
    fontsHref: 'https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&display=swap',
    chrome: '#071a33',
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    description: 'Oscilloscope green on black, scanlines and vector traces.',
    swatch: ['#020403', '#0f5a2c', '#39ff7a'],
    fontsHref: 'https://fonts.googleapis.com/css2?family=VT323&display=swap',
    chrome: '#020403',
  },
];

export const DEFAULT_THEME = 'studio';

export function themeById(id: string | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}
