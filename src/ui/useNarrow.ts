import { useEffect, useState } from 'preact/hooks';

/** Matches the CSS breakpoint where the layout goes compact. */
const NARROW = '(max-width: 820px)';

/** True on phone-sized screens; follows resizes and rotation. */
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(NARROW).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(NARROW);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}
