// GET /api/tray/latest (functions/src/trayCore.ts): Tauri's updater manifest
// for the Windows tray. Raw JSON stops here; the Download card sees TrayRelease.

/** Tauri's key for the 64-bit Windows build. */
const PLATFORM = 'windows-x86_64';

export type TrayRelease = {
  version: string;
  /** What the card says it is. */
  notes: string;
};

/** The manifest's version and notes; null when it is not a Windows release. */
export function toTrayRelease(raw: unknown): TrayRelease | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as {
    version?: unknown;
    notes?: unknown;
    platforms?: Record<string, {url?: unknown}>;
  };
  if (typeof o.version !== 'string' || o.version === '') return null;
  const url = o.platforms?.[PLATFORM]?.url;
  if (typeof url !== 'string' || url === '') return null;
  return {
    version: o.version,
    notes: typeof o.notes === 'string' ? o.notes : '',
  };
}
