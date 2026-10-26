import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { offersFor } from '../../shared/browse';
import { addDays, mondayOf, todayIso } from '../../shared/dates';
import { reservableLimit } from '../../shared/orders';
import type { Category, Confidence, Product, SupplyWindow } from '../../shared/types';
import { ctx, type Bootstrap } from '../api';
import { loc } from '../i18n';
import { fmtDate } from './StockEditor';

const WEEKS = 8;
const favKey = (buyerId: string) => `fav:${ctx.session}:${buyerId}`;

/** Menu planner: what is likely to be available, product by week, across all local producers. */
export function Planner({ buyerId, boot, windows, onPick }: {
  buyerId: string; boot: Bootstrap; windows: SupplyWindow[]; onPick: (date: string, productName: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [favs, setFavs] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem(favKey(buyerId)) ?? '[]')));
  const [onlyFavs, setOnlyFavs] = useState(false);
  const today = todayIso();
  const mondays = Array.from({ length: WEEKS }, (_, i) => addDays(mondayOf(today), i * 7));

  const toggle = (id: string) => {
    const next = new Set(favs);
    if (!next.delete(id)) next.add(id);
    setFavs(next);
    localStorage.setItem(favKey(buyerId), JSON.stringify([...next]));
  };

  const grid = useMemo(() => {
    const offers = offersFor(buyerId, boot).filter((o) => o.status !== 'hidden');
    const byProduct = new Map<string, { product: Product; category: Category; listingIds: Set<string>; rules: { days: number[]; lead: number }[] }>();
    for (const o of offers) {
      const e = byProduct.get(o.product.id) ?? { product: o.product, category: o.category, listingIds: new Set(), rules: [] };
      e.listingIds.add(o.listing.id);
      e.rules.push(o.rule);
      byProduct.set(o.product.id, e);
    }
    const win = new Map(windows.map((w) => [`${w.listingId}#${w.start}`, w]));
    return [...byProduct.values()]
      .sort((a, b) => a.category.id.localeCompare(b.category.id) || a.product.name.en.localeCompare(b.product.name.en))
      .map((e) => ({
        ...e,
        cells: mondays.map((m) => {
          let inStock = 0, forecast = 0, planned = false;
          for (const lid of e.listingIds) {
            const w = win.get(`${lid}#${m}`);
            if (!w) continue;
            const free = Math.max(0, reservableLimit(boot.config, w) - w.qtyReserved);
            if (w.confidence === 'in_stock') inStock += free;
            else if (w.confidence === 'forecast') forecast += free;
            planned = true;
          }
          const best: Confidence | undefined = inStock > 0 ? 'in_stock' : forecast > 0 ? 'forecast' : planned ? 'provisional' : undefined;
          return { monday: m, qty: inStock + forecast, best };
        }),
      }));
  }, [buyerId, boot, windows, mondays.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = grid.filter((r) => !onlyFavs || favs.has(r.product.id));
  const style: Record<Confidence, string> = {
    in_stock: 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200',
    forecast: 'bg-gold-light text-amber-900 hover:bg-amber-200',
    provisional: 'bg-slate-100 text-slate-600 hover:bg-slate-200',
  };

  /** First day in that week on which at least one local producer can deliver this product, respecting notice. */
  const firstDelivery = (monday: string, rules: { days: number[]; lead: number }[]) => {
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      const dow = new Date(d + 'T00:00:00Z').getUTCDay();
      if (rules.some((r) => d >= addDays(today, Math.max(r.lead, 1)) && r.days.includes(dow))) return d;
    }
    return undefined;
  };

  return (
    <div>
      <p className="mb-3 text-slate-600">{t('plannerIntro')}</p>
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyFavs} onChange={(e) => setOnlyFavs(e.target.checked)} />{t('onlyUsual')}</label>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[48rem] text-left text-sm" data-testid="planner">
          <thead className="bg-brand-light text-brand-dark">
            <tr>
              <th className="p-2">{t('product')}</th>
              {mondays.map((m) => <th key={m} className="p-2 text-center">{fmtDate(m, i18n.language)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.product.id} className="border-t border-slate-100" data-testid={`planner-${r.product.id}`}>
                <td className="p-2">
                  <button aria-label={t('usual')} aria-pressed={favs.has(r.product.id)} title={t('usual')} onClick={() => toggle(r.product.id)}
                    className={`mr-2 text-lg ${favs.has(r.product.id) ? 'text-gold' : 'text-slate-300 hover:text-gold'}`}>★</button>
                  <span className="font-medium">{loc(r.product.name)}</span> <span className="text-xs text-slate-500">({t(`units.${r.product.unit}`)})</span>
                </td>
                {r.cells.map((c) => {
                  const date = c.best ? firstDelivery(c.monday, r.rules) : undefined;
                  return (
                    <td key={c.monday} className="p-1 text-center">
                      {c.best && date && c.best !== 'provisional' ? (
                        <button data-testid={`cell-${r.product.id}-${c.monday}`} data-conf={c.best} className={`w-full rounded px-1 py-1.5 font-semibold ${style[c.best]}`}
                          onClick={() => onPick(date, r.product.name.en)}>{c.qty}</button>
                      ) : c.best && c.best !== 'provisional' ? (
                        <span data-conf={c.best} title={t('noDeliveryLeft')} className={`block rounded px-1 py-1.5 opacity-60 ${style[c.best].split(' hover')[0]}`}>{c.qty}</span>
                      ) : c.best ? (
                        <span data-conf={c.best} className={`block rounded px-1 py-1.5 ${style.provisional}`}>{t('plannerPlanned')}</span>
                      ) : <span className="block py-1.5 text-slate-300">–</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex gap-4 text-xs text-slate-600">
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-emerald-200" />{t('conf_in_stock')}</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-gold-light" />{t('conf_forecast')}</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-slate-200" />{t('plannerPlanned')}</span>
      </p>
    </div>
  );
}
