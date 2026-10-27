import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, todayIso } from '../../shared/dates';
import { MAX_DAYS_AHEAD } from '../../shared/delivery';
import { api, type Bootstrap } from '../api';
import { longDate } from './Browse';

/**
 * A producer adds a one-off day to their usual delivery rounds, for a special delivery. Buyers can then order their
 * products for that day, like any other delivery day (as long as there is stock that week).
 */
export function ExtraDays({ producerId, boot, reload }: { producerId: string; boot: Bootstrap; reload: () => void }) {
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const mine = (boot.extraDays ?? []).filter((e) => e.producerId === producerId).sort((a, b) => a.date.localeCompare(b.date));
  const today = todayIso();

  const run = async (f: () => Promise<unknown>): Promise<boolean> => {
    try { setError(''); await f(); reload(); return true; } catch (e) { setError((e as Error).message); return false; }
  };

  return (
    <section data-testid="extra-days" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold text-brand-dark">{t('extraDaysTitle')}</h3>
      <p className="text-sm text-slate-600">{t('extraDaysHelp')}</p>
      <form className="mt-3 flex flex-wrap items-end gap-3 text-sm" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api('/extra-days', { method: 'POST', body: JSON.stringify({ date, note: note.trim() || undefined }) }))) { setDate(''); setNote(''); }
      }}>
        <label>{t('extraDayDate')}
          <input required type="date" min={addDays(today, 1)} max={addDays(today, MAX_DAYS_AHEAD)} value={date} onChange={(e) => setDate(e.target.value)}
            className="ml-2 rounded border border-slate-300 px-2 py-1" />
        </label>
        <label className="min-w-48 flex-1">{t('extraDayNote')}
          <input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder={t('extraDayNotePlaceholder')}
            className="ml-2 w-full rounded border border-slate-300 px-2 py-1" />
        </label>
        <button className="rounded bg-brand px-4 py-1.5 font-semibold text-white hover:bg-brand-dark">{t('addExtraDay')}</button>
      </form>
      {error && <p role="alert" className="mt-2 rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}
      {mine.length === 0 ? <p className="mt-3 text-sm text-slate-500">{t('noExtraDays')}</p> : (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {mine.map((e) => (
            <li key={e.date} data-testid={`extra-day-${e.date}`} className="flex flex-wrap items-center gap-3 py-1.5">
              <b>{longDate(e.date, i18n.language)}</b>
              {e.note && <span className="text-slate-600">{e.note}</span>}
              <button className="ml-auto text-red-700 underline" onClick={() => run(() => api(`/extra-days?date=${e.date}`, { method: 'DELETE' }))}>{t('remove')}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
