import { describeDays } from '../shared/availability';

/** "Thu 12 Nov" in the current language. */
export const shortDate = (iso: string, lang: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString(lang === 'cy' ? 'cy-GB' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** A length of time in plain words: "2 days", "3 weeks", "2 months". */
export const duration = (t: (k: string, o?: Record<string, unknown>) => string, days: number) => {
  const { unit, n } = describeDays(days);
  return t(`dur_${unit}`, { count: n });
};
