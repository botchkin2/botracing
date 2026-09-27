// How far back LMU laps are kept. Seven calendar days, including today,
// in UTC. LMU_SINCE=YYYYMMDD overrides it.

export function sinceDay() {
  const override = process.env.LMU_SINCE;
  if (override) return override.replaceAll('-', '');
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - 6);
  const y = day.getUTCFullYear();
  const m = String(day.getUTCMonth() + 1).padStart(2, '0');
  const d = String(day.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function dayOf(value) {
  const match = String(value || '').match(/(\d{8})T/);
  return match ? match[1] : '';
}

export function inWindow(value, since = sinceDay()) {
  const day = dayOf(value);
  return Boolean(day) && day >= since;
}

export function tooOld(value, since = sinceDay()) {
  const day = dayOf(value);
  return Boolean(day) && day < since;
}
