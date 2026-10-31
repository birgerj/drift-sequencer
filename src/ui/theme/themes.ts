/**
 * Theme registry. A theme is a set of values for the CSS custom properties
 * declared on :root in styles.css (the contract), plus optional fonts and
 * optional "extras": themed components that replace a default one in a slot.
 * Adding a theme = one CSS block under [data-theme="id"] + one entry here.
 */
export type ThemeSlot =
  /** Meters under the transport in the rail. */
  | 'railMeters'
  /** Pattern display on a track's Overview tab (melodic tracks). */
  | 'overviewPattern'
  /** Hero at the top of the Harmony page. */
  | 'harmonyHero'
  /** Decoration in each device card on the Devices page. */
  | 'deviceDecor';

export interface ThemeDef {
  id: string;
  name: string;
  description: string;
  /** Colours for the picker's preview chip. */
  swatch: [string, string, string];
  /** Google Fonts stylesheet; offline the CSS falls back to system fonts. */
  fontsHref?: string;
  /** Slots this theme fills with its own component. */
  slots: ThemeSlot[];
  /** <meta name="theme-color"> value. */
  chrome: string;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'studio',
    name: 'Studio',
    description: 'Dark and calm; colour comes from the tracks.',
    swatch: ['#0b0c0f', '#1a1d23', '#f5a524'],
    slots: [],
    chrome: '#0b0c0f',
  },
  {
    id: 'hifi',
    name: 'Hi-Fi',
    description: 'Retro stereo tower: brushed aluminium, VFD displays, VU meters, walnut.',
    swatch: ['#c9ced3', '#060b0d', '#7ff6ff'],
    fontsHref: 'https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@500;600;700&family=Share+Tech+Mono&display=swap',
    slots: ['railMeters', 'overviewPattern', 'harmonyHero', 'deviceDecor'],
    chrome: '#1b1410',
  },
];

export const DEFAULT_THEME = 'studio';

export function themeById(id: string | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}
