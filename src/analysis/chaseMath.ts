// Small numeric helpers the chase view shares. Plain TypeScript, no imports.

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const mod = (a: number, n: number) => ((a % n) + n) % n;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** The signed turn from angle a to angle b, in (-pi, pi]. */
export const angDiff = (a: number, b: number) => mod(b - a + Math.PI, TAU) - Math.PI;
/** Frame-rate independent exponential approach: the share of the gap closed in dt with time constant tau. */
/**
 * A step of no time (dt 0, a paused frame), or of negative or unknown time, moves nothing; with no time constant
 * (tau 0, a camera that is not smoothed) any positive step arrives at once. Never NaN: ease(0, 0) is 0 / 0.
 */
export const ease = (dt: number, tau: number) => (dt > 0 ? (tau > 0 ? 1 - Math.exp(-dt / tau) : 1) : 0);
