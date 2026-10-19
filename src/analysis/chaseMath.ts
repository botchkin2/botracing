// Small numeric helpers the chase view shares. Plain TypeScript, no imports.

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const mod = (a: number, n: number) => ((a % n) + n) % n;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** The signed turn from angle a to angle b, in (-pi, pi]. */
export const angDiff = (a: number, b: number) => mod(b - a + Math.PI, TAU) - Math.PI;
/** Frame-rate independent exponential approach: the share of the gap closed in dt with time constant tau. */
export const ease = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);
