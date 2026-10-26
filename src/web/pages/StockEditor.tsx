import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { orderableQty } from '../../shared/browse';
import { addDays, mondayOf, todayIso } from '../../shared/dates';
import type { ModelConfig } from '../../shared/models';
import type { Confidence, Listing, Product, SupplyWindow } from '../../shared/types';
import { api } from '../api';
import { loc } from '../i18n';

export const CONFIDENCES: Confidence[] = ['in_stock', 'forecast', 'provisional'];
export const CONF_STYLE: Record<Confidence, string> = {
  in_stock: 'border-emerald-400 bg-emerald-50',
  forecast: 'border-amber-400 bg-gold-light',
  provisional: 'border-slate-300 bg-slate-100',
};
const WEEKS_SHOWN = 12;

export const fmtDate = (iso: string, lang: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString(lang === 'cy' ? 'cy-GB' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Weekly supply grid for one listing: edit quantity and confidence, add or remove weeks. */
export function StockCard({ listing, product, windows, config, reload }: {
  listing: Listing; product: Product; windows: SupplyWindow[]; config: ModelConfig; reload: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [error, setError] = useState('');
  const thisMonday = mondayOf(todayIso());
  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => addDays(thisMonday, i * 7));
  const byStart = new Map(windows.map((w) => [w.start, w]));
  const lastQty = [...windows].sort((a, b) => b.start.localeCompare(a.start))[0]?.qtyTotal ?? listing.minOrder * 10;

  const run = async (f: () => Promise<unknown>) => {
    try { setError(''); await f(); reload(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid={`stock-${listing.id}`}>
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-semibold">{loc(product.name)}</h2>
        <span className="text-slate-500">£{listing.pricePerUnit.toFixed(2)} {t('perUnit', { unit: t(`units.${product.unit}`) })}</span>
        <button className="ml-auto rounded border border-brand px-3 py-1 text-sm font-medium text-brand hover:bg-brand-light"
          onClick={() => setBulkOpen((o) => !o)}>{t('addFour')}</button>
      </div>

      {bulkOpen && (
        <BulkForm defaultQty={lastQty} onCancel={() => setBulkOpen(false)}
          onSubmit={(qtyTotal, confidence) => run(async () => {
            await api('/windows/bulk', { method: 'POST', body: JSON.stringify({ listingId: listing.id, from: thisMonday, weeks: 4, qtyTotal, confidence }) });
            setBulkOpen(false);
          })} />
      )}
      {error && <p role="alert" className="mt-2 rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {weeks.map((monday) => (
          <WeekCell key={monday} monday={monday} current={monday === thisMonday}
            win={byStart.get(monday)} listing={listing} product={product} config={config} lang={i18n.language}
            onAdd={() => run(() => api('/windows', { method: 'PUT', body: JSON.stringify({
              listingId: listing.id, start: monday, qtyTotal: lastQty, confidence: monday <= addDays(thisMonday, 7) ? 'in_stock' : 'forecast' }) }))}
            onSave={(qtyTotal, confidence) => run(() => api('/windows', { method: 'PUT', body: JSON.stringify({ listingId: listing.id, start: monday, qtyTotal, confidence }) }))}
            onRemove={() => { if (confirm(t('confirmRemoveWeek'))) void run(() => api(`/windows?listingId=${encodeURIComponent(listing.id)}&start=${monday}`, { method: 'DELETE' })); }}
          />
        ))}
      </div>
    </section>
  );
}

function WeekCell({ monday, current, win, listing, product, config, lang, onAdd, onSave, onRemove }: {
  monday: string; current: boolean; win?: SupplyWindow; listing: Listing; product: Product; config: ModelConfig; lang: string;
  onAdd: () => void; onSave: (qty: number, c: Confidence) => void; onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [qty, setQty] = useState(String(win?.qtyTotal ?? ''));
  const [conf, setConf] = useState<Confidence>(win?.confidence ?? 'forecast');
  const [dirty, setDirty] = useState(false);
  // Pick up changes made elsewhere (another session, an order) unless the user is mid-edit.
  useEffect(() => { if (!dirty && win) { setQty(String(win.qtyTotal)); setConf(win.confidence); } }, [win?.qtyTotal, win?.confidence, dirty]);

  const month = Number(monday.slice(5, 7));
  const outOfSeason = product.season.length > 0 && !product.season.includes(month);

  if (!win) {
    return (
      <div className="flex min-h-28 flex-col justify-between rounded border border-dashed border-slate-300 p-2 text-sm">
        <div className="text-xs text-slate-500">{current ? `${t('thisWeek')} · ` : ''}{fmtDate(monday, lang)}</div>
        {outOfSeason && <span className="text-xs text-slate-500">{t('outOfSeason')}</span>}
        <button className="rounded bg-brand-light px-2 py-1 font-medium text-brand hover:bg-blue-100" onClick={onAdd}>{t('addWeek')}</button>
      </div>
    );
  }

  const commit = (q: string, c: Confidence) => {
    const n = Number(q);
    setDirty(false);
    if (Number.isInteger(n) && n >= 0 && (n !== win.qtyTotal || c !== win.confidence)) onSave(n, c);
    else { setQty(String(win.qtyTotal)); setConf(win.confidence); }
  };
  const orderable = orderableQty(config, win);

  return (
    <div className={`rounded border p-2 text-sm ${CONF_STYLE[conf]}`} data-testid={`week-${monday}`}>
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span>{current ? `${t('thisWeek')} · ` : ''}{fmtDate(monday, lang)}</span>
        <button aria-label={t('remove')} title={t('remove')} className="px-1 text-slate-500 hover:text-red-700" onClick={onRemove}>×</button>
      </div>
      <label className="mt-1 block text-xs text-slate-600">{t('quantity')} ({t(`units.${product.unit}`)})
        <input type="number" min={0} step={1} inputMode="numeric" value={qty} aria-label={`${t('quantity')} ${fmtDate(monday, lang)}`}
          className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 text-base font-semibold"
          onChange={(e) => { setQty(e.target.value); setDirty(true); }}
          onBlur={() => dirty && commit(qty, conf)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </label>
      <select value={conf} aria-label={`${t('confidence')} ${fmtDate(monday, lang)}`} title={t(`confHelp_${conf}`)}
        className="mt-1 block w-full rounded border border-slate-300 bg-white px-1 py-1"
        onChange={(e) => { const c = e.target.value as Confidence; setConf(c); commit(qty, c); }}>
        {CONFIDENCES.map((c) => <option key={c} value={c}>{t(`conf_${c}`)}</option>)}
      </select>
      <div className="mt-1 text-xs text-slate-600">
        {win.qtyReserved > 0 && <div title={t('notEditable', { n: win.qtyReserved })}>{t('reservedQty', { n: win.qtyReserved })}</div>}
        <div>{t('orderableNow')}: <b>{orderable}</b></div>
        {outOfSeason && <div className="text-amber-800">{t('outOfSeason')}</div>}
      </div>
    </div>
  );
}

function BulkForm({ defaultQty, onSubmit, onCancel }: { defaultQty: number; onSubmit: (q: number, c: Confidence) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [qty, setQty] = useState(String(defaultQty));
  const [conf, setConf] = useState<Confidence>('forecast');
  return (
    <form className="mt-3 flex flex-wrap items-end gap-3 rounded bg-brand-light p-3 text-sm"
      onSubmit={(e) => { e.preventDefault(); const n = Number(qty); if (Number.isInteger(n) && n >= 0) onSubmit(n, conf); }}>
      <span className="basis-full text-slate-700">{t('addFourHelp')}</span>
      <label>{t('quantity')}<input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)}
        className="ml-2 w-24 rounded border border-slate-300 bg-white px-2 py-1" /></label>
      <label>{t('confidence')}<select value={conf} onChange={(e) => setConf(e.target.value as Confidence)}
        className="ml-2 rounded border border-slate-300 bg-white px-2 py-1">
        {CONFIDENCES.map((c) => <option key={c} value={c}>{t(`conf_${c}`)}</option>)}
      </select></label>
      <button className="rounded bg-brand px-3 py-1 font-semibold text-white">{t('save')}</button>
      <button type="button" className="px-2 py-1 text-slate-600 underline" onClick={onCancel}>{t('cancel')}</button>
    </form>
  );
}
