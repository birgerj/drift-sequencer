/**
 * Euclidean rhythm: `pulses` hits spread as evenly as possible over `steps`,
 * rotated right by `rotate`. euclid(3, 8) → x..x..x.
 */
export function euclid(pulses: number, steps: number, rotate = 0): boolean[] {
  const p = Math.max(0, Math.min(steps, Math.round(pulses)));
  const base: boolean[] = [];
  for (let i = 0; i < steps; i++) base.push((i * p) % steps < p);
  if (steps === 0) return base;
  const r = ((rotate % steps) + steps) % steps;
  return base.map((_, i) => base[(i - r + steps) % steps]!);
}
