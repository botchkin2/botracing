/** Every React Query key for /fuel-presets lives here. */
export const presetKeys = {
  /** The account's list as last read or written (src/features/plan/presetSync.ts reconciles the device's with it). */
  account: ['fuel-presets', 'account'] as const,
};
