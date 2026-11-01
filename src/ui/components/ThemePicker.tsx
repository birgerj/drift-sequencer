import { applyTheme, useTheme } from "../theme/theme";
import { THEMES } from "../theme/themes";

/** Theme switcher: one chip per theme, with a colour preview. */
export function ThemePicker() {
  const theme = useTheme();
  return (
    <div class="theme-picker" role="radiogroup" aria-label="Theme">
      <span>Theme</span>
      {THEMES.map((t) => (
        <button
          type="button"
          role="radio"
          aria-checked={t.id === theme.id}
          title={`${t.name}: ${t.description} (Shift+T)`}
          onClick={() => applyTheme(t.id)}
        >
          <span class="theme-swatch" aria-hidden="true">
            {t.swatch.map((c) => (
              <i style={{ background: c }} />
            ))}
          </span>
          {t.name}
        </button>
      ))}
    </div>
  );
}
