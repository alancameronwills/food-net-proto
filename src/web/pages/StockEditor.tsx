import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { orderableQty } from '../../shared/browse';
import { addDays, mondayOf, PLANNING_WEEKS, todayIso } from '../../shared/dates';
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

export const fmtDate = (iso: string, lang: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString(lang === 'cy' ? 'cy-GB' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const NEXT_CONF: Record<Confidence, Confidence> = { provisional: 'forecast', forecast: 'in_stock', in_stock: 'provisional' };
const CONF_ICON: Record<Confidence, string> = { in_stock: '●', forecast: '◐', provisional: '○' };
const CONF_ICON_STYLE: Record<Confidence, string> = {
  in_stock: 'border-emerald-500 bg-emerald-100 text-emerald-800',
  forecast: 'border-amber-500 bg-gold-light text-amber-800',
  provisional: 'border-slate-400 bg-slate-100 text-slate-600',
};

/** Supply grid for all of a producer's listings: products down the side, weeks across the top. Both stay put while scrolling. */
export function StockTable({ listings, products, windows, config, reload }: {
  listings: Listing[]; products: Map<string, Product>; windows: SupplyWindow[]; config: ModelConfig; reload: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [bulkFor, setBulkFor] = useState<string>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [info, setInfo] = useState('');
  const thisMonday = mondayOf(todayIso());
  const weeks = Array.from({ length: PLANNING_WEEKS + 1 }, (_, i) => addDays(thisMonday, i * 7));
  const run = async (f: () => Promise<unknown>) => {
    try {
      setError(''); setNotice(''); setInfo('');
      const r = (await f()) as { flagged?: number; created?: number } | undefined;
      if (r?.flagged) setNotice(t('cutWarning', { n: r.flagged }));
      if (r?.created !== undefined) setInfo(t('bulkDone', { count: r.created }));
      reload();
    } catch (e) { setError((e as Error).message); }
  };
  const bulkListing = listings.find((l) => l.id === bulkFor);
  const lastQtyOf = (l: Listing) => [...windows.filter((w) => w.listingId === l.id)].sort((a, b) => b.start.localeCompare(a.start))[0]?.qtyTotal ?? l.minOrder * 10;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      {bulkListing && (
        <BulkForm key={bulkListing.id} title={loc(products.get(bulkListing.productId)!.name)} defaultQty={lastQtyOf(bulkListing)} onCancel={() => setBulkFor(undefined)}
          onSubmit={(qtyTotal, confidence) => run(async () => {
            const r = await api<{ created: number }>('/windows/bulk', { method: 'POST', body: JSON.stringify({ listingId: bulkListing.id, from: thisMonday, weeks: 4, qtyTotal, confidence }) });
            setBulkFor(undefined);
            return r;
          })} />
      )}
      {error && <p role="alert" className="m-2 rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}
      {info && <p role="status" data-testid="bulk-done" className="m-2 rounded bg-emerald-100 p-2 text-sm text-emerald-900">{info}</p>}
      {notice && <p role="status" data-testid="cut-warning" className="m-2 rounded bg-orange-100 p-2 text-sm font-semibold text-orange-900">{notice}</p>}
      <div className="max-h-[70vh] overflow-auto" data-testid="stock-scroll">
        <table className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 min-w-40 border-b border-r border-slate-300 bg-white p-2 text-left text-xs text-slate-600">{t('tabStock')}</th>
              {weeks.map((m) => (
                <th key={m} className={`sticky top-0 z-20 min-w-28 whitespace-nowrap border-b border-slate-300 p-2 text-center text-xs text-slate-700 ${m === thisMonday ? 'bg-gold-light font-bold' : 'bg-white font-semibold'}`}>
                  {m === thisMonday && <div>{t('thisWeek')}</div>}{fmtDate(m, i18n.language)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => {
              const product = products.get(l.productId)!;
              const byStart = new Map(windows.filter((w) => w.listingId === l.id).map((w) => [w.start, w]));
              const lastQty = lastQtyOf(l);
              return (
                <tr key={l.id} data-testid={`stock-${l.id}`}>
                  <th scope="row" className="sticky left-0 z-10 border-b border-r border-slate-300 bg-white p-2 text-left align-top font-normal">
                    <h2 className="font-semibold">{loc(product.name)}</h2>
                    <div className="text-xs text-slate-500">£{l.pricePerUnit.toFixed(2)} {t('perUnit', { unit: t(`units.${product.unit}`) })}</div>
                    <button className="mt-1 text-xs font-medium text-brand underline" onClick={() => setBulkFor(bulkFor === l.id ? undefined : l.id)}>{t('addFour')}</button>
                  </th>
                  {weeks.map((monday) => (
                    <td key={monday} className="border-b border-slate-200 p-1 align-top">
                      <WeekCell monday={monday} win={byStart.get(monday)} product={product} config={config} lang={i18n.language}
                        onAdd={() => run(() => api('/windows', { method: 'PUT', body: JSON.stringify({
                          listingId: l.id, start: monday, qtyTotal: lastQty, confidence: 'provisional' }) }))}
                        onSave={(qtyTotal, confidence) => run(() => api('/windows', { method: 'PUT', body: JSON.stringify({ listingId: l.id, start: monday, qtyTotal, confidence }) }))}
                        onRemove={() => { if (confirm(t('confirmRemoveWeek'))) void run(() => api(`/windows?listingId=${encodeURIComponent(l.id)}&start=${monday}`, { method: 'DELETE' })); }}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WeekCell({ monday, win, product, config, lang, onAdd, onSave, onRemove }: {
  monday: string; win?: SupplyWindow; product: Product; config: ModelConfig; lang: string;
  onAdd: () => void; onSave: (qty: number, c: Confidence) => void; onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [qty, setQty] = useState(String(win?.qtyTotal ?? ''));
  const [conf, setConf] = useState<Confidence>(win?.confidence ?? 'forecast');
  const [dirty, setDirty] = useState(false);
  const [flash, setFlash] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(pending.current), []);
  // Pick up changes made elsewhere (another session, an order) unless the user is mid-edit.
  useEffect(() => { if (!dirty && win) { setQty(String(win.qtyTotal)); setConf(win.confidence); } }, [win?.qtyTotal, win?.confidence, dirty]);
  // The state name shows briefly after each click; every click restarts the timer
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), 1600);
    return () => clearTimeout(timer);
  }, [flash, conf]);

  const month = Number(monday.slice(5, 7));
  const outOfSeason = product.season.length > 0 && !product.season.includes(month);

  if (!win) {
    return (
      <div className="flex min-h-16 flex-col justify-center gap-1" data-testid={`empty-${monday}`}>
        {outOfSeason && <span className="text-[11px] text-slate-500">{t('outOfSeason')}</span>}
        <button className="rounded bg-brand-light px-2 py-1 text-xs font-medium text-brand hover:bg-blue-100" onClick={onAdd}>{t('addWeek')}</button>
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
  // Several quick clicks save once, after the last: separate saves could arrive out of order
  const cycle = () => {
    const c = NEXT_CONF[conf];
    setConf(c); setFlash(true); setDirty(true);
    clearTimeout(pending.current);
    pending.current = setTimeout(() => commit(qty, c), 450);
  };

  return (
    <div className={`relative rounded border p-1 ${CONF_STYLE[conf]}`} data-testid={`week-${monday}`}>
      <div className="flex items-center gap-1">
        <input type="number" min={0} step={1} inputMode="numeric" value={qty} aria-label={`${t('quantity')} ${fmtDate(monday, lang)} (${t(`units.${product.unit}`)})`}
          className="w-[8ch] rounded border border-slate-300 bg-white px-1 py-0.5 text-sm font-semibold"
          onChange={(e) => { setQty(e.target.value); setDirty(true); }}
          onBlur={() => dirty && commit(qty, conf)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <button type="button" aria-label={`${t('confidence')} ${fmtDate(monday, lang)}: ${t(`conf_${conf}`)}`} title={t(`confHelp_${conf}`)}
          data-confidence={conf}
          className={`h-6 w-6 shrink-0 rounded-full border text-sm leading-none ${CONF_ICON_STYLE[conf]}`} onClick={cycle}>{CONF_ICON[conf]}</button>
        <button aria-label={t('remove')} title={t('remove')} className="px-1 text-slate-500 hover:text-red-700" onClick={onRemove}>×</button>
      </div>
      {flash && <span role="status" data-testid="conf-flash" className="absolute -top-2 left-8 z-40 whitespace-nowrap rounded bg-slate-800 px-2 py-0.5 text-xs text-white shadow">{t(`conf_${conf}`)}</span>}
      <div className="mt-1 text-[11px] leading-tight text-slate-600">
        {win.qtyReserved > 0 && <div title={t('notEditable', { n: win.qtyReserved })}>{t('reservedQty', { n: win.qtyReserved })}</div>}
        <div>{t('orderableNow')}: <b>{orderable}</b></div>
        {outOfSeason && <div className="text-amber-800">{t('outOfSeason')}</div>}
      </div>
    </div>
  );
}

export function BulkForm({ title, defaultQty, onSubmit, onCancel }: { title?: string; defaultQty: number; onSubmit: (q: number, c: Confidence) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [qty, setQty] = useState(String(defaultQty));
  const [conf, setConf] = useState<Confidence>('provisional');
  return (
    <form className="mt-3 flex flex-wrap items-end gap-3 rounded bg-brand-light p-3 text-sm"
      onSubmit={(e) => { e.preventDefault(); const n = Number(qty); if (Number.isInteger(n) && n >= 0) onSubmit(n, conf); }}>
      <span className="basis-full text-slate-700">{title && <b>{title}: </b>}{t('addFourHelp')}</span>
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
