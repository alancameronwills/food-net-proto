// Calendar dates are plain YYYY-MM-DD strings handled in UTC, so server, browser and tests agree.
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
export const todayIso = (): string => isoDate(new Date());

export const isIsoDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoDate(new Date(s + 'T00:00:00Z')) === s;

export const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
};

/** Monday of the week containing `iso` (supply windows are Monday-to-Sunday weeks). */
export const mondayOf = (iso: string): string => {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
};

export const isMonday = (iso: string): boolean => new Date(iso + 'T00:00:00Z').getUTCDay() === 1;
