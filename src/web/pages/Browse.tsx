import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { offersFor } from '../../shared/browse';
import { addDays, todayIso } from '../../shared/dates';
import { dayNames, WEEKDAYS } from '../../shared/delivery';
import { availabilityFor, windowKey, type Unavailable } from '../../shared/orders';
import { capabilities } from '../../shared/models';
import type { SupplyWindow } from '../../shared/types';
import type { Bootstrap } from '../api';
import { loc } from '../i18n';
import { CONF_STYLE } from './StockEditor';
import { TrustChip } from './TrustChip';

export const longDate = (iso: string, lang: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString(lang === 'cy' ? 'cy-GB' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Browse what is available for one delivery date, and put it in the basket. */
export function Browse({ buyerId, boot, windows, date, onDate, qtyInCart, onAdd, search, onSearch }: {
  buyerId: string; boot: Bootstrap; windows: SupplyWindow[]; date: string; onDate: (d: string) => void;
  qtyInCart: Record<string, number>; onAdd: (listingId: string, qty: number) => void;
  search: string; onSearch: (s: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [category, setCategory] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const caps = capabilities(boot.config);
  const today = todayIso();

  const byWindow = useMemo(() => new Map(windows.map((w) => [`${w.listingId}#${w.start}`, w])), [windows]);
  const rows = useMemo(() => offersFor(buyerId, boot)
    .filter((o) => o.status !== 'hidden')
    .map((o) => ({
      o,
      av: availabilityFor({
        config: boot.config, category: o.category, listing: o.listing, window: byWindow.get(windowKey(o.listing.id, date)),
        date, today, driveKm: o.driveKm, rule: o.rule,
      }),
    })), [buyerId, boot, byWindow, date, today]);

  // How much could be ordered on each of the next two weeks of days: shows at a glance when this buyer can be served
  const strip = useMemo(() => {
    const offers = offersFor(buyerId, boot).filter((o) => o.status !== 'hidden');
    return Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today, i + 1);
      const n = offers.filter((o) => availabilityFor({
        config: boot.config, category: o.category, listing: o.listing, window: byWindow.get(windowKey(o.listing.id, d)), date: d, today, driveKm: o.driveKm, rule: o.rule,
      }).orderable > 0).length;
      return { d, n };
    });
  }, [buyerId, boot, byWindow, today]);
  const lang = i18n.language === 'cy' ? 'cy' : 'en';

  const q = search.trim().toLowerCase();
  const shown = rows
    .filter(({ o, av }) => (!category || o.category.id === category) && (!onlyAvailable || av.orderable > 0)
      && (!q || `${o.product.name.en} ${o.product.name.cy} ${o.producer.name}`.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.av.orderable > 0) - Number(a.av.orderable > 0) || a.o.category.id.localeCompare(b.o.category.id) || a.o.driveKm - b.o.driveKm);
  const hiddenByRange = offersFor(buyerId, boot).filter((o) => o.status === 'hidden').length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <label className="text-sm font-medium">{t('deliveryOn')}
          <input type="date" value={date} min={addDays(today, 1)} max={addDays(today, 180)} onChange={(e) => e.target.value && onDate(e.target.value)}
            className="ml-2 rounded border border-slate-300 px-2 py-1 text-base" aria-label={t('deliveryOn')} />
        </label>
        <span className="text-lg font-semibold text-brand" data-testid="delivery-long">{longDate(date, i18n.language)}</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded border border-slate-300 px-2 py-1" aria-label={t('allCategories')}>
          <option value="">{t('allCategories')}</option>
          {boot.categories.map((c) => <option key={c.id} value={c.id}>{loc(c.name)}</option>)}
        </select>
        <input type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder={t('searchProducts')} aria-label={t('searchProducts')}
          className="rounded border border-slate-300 px-2 py-1" />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} />{t('onlyAvailable')}</label>
      </div>

      <div className="mb-4" data-testid="day-strip">
        <div className="mb-1 flex flex-wrap items-baseline gap-x-3 text-sm text-slate-600">
          <span className="font-medium">{t('pickDay')}</span>
          {boot.config.delivery === 'hub_courier' && <span data-testid="hub-info">{t('hubInfo', { days: dayNames(boot.config.hubDays, lang), n: 2 })}</span>}
          {boot.config.delivery !== 'hub_courier' && <span>{t(`deliveryModeNote_${boot.config.delivery}`, { days: '' })}</span>}
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {strip.map(({ d, n }) => {
            const dt = new Date(d + 'T00:00:00Z');
            return (
              <button key={d} data-testid={`day-${d}`} data-count={n} onClick={() => onDate(d)} aria-pressed={d === date}
                className={`min-w-16 shrink-0 rounded border px-2 py-1 text-center text-xs ${d === date ? 'border-brand bg-brand text-white' : n > 0 ? 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100' : 'border-slate-200 bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                <div className="font-semibold">{WEEKDAYS[lang][dt.getUTCDay()]} {dt.getUTCDate()}</div>
                <div>{n > 0 ? t('dayCount', { n }) : '–'}</div>
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 && <p className="text-slate-600">{t('noMatches')}</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map(({ o, av }) => {
          const id = o.listing.id;
          const inCart = qtyInCart[id] ?? 0;
          const can = av.orderable > 0;
          const val = draft[id] ?? String(o.listing.minOrder);
          const tiers = caps.volumeTiers ? o.listing.tiers : undefined;
          return (
            <article key={id} data-testid={`offer-${id}`} className={`rounded-lg border p-3 shadow-sm ${can ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-lg font-semibold">{loc(o.product.name)}</h3>
                <span className="text-xs">{loc(o.category.name)}</span>
                {o.listing.certifications.map((c) => <span key={c} className="rounded bg-emerald-100 px-1.5 text-xs text-emerald-800">{c}</span>)}
              </div>
              <div className="text-sm">{o.producer.name} · {o.producer.town} · {t('km', { n: o.driveKm })}
                {av.farWarning && <span className="ml-2 rounded bg-gold-light px-1.5 text-xs font-semibold text-amber-900">{t('farWarning')}</span>}
                <span className="ml-2"><TrustChip producerId={o.producer.id} boot={boot} /></span>
                {o.rule.mode === 'area_days' && o.rule.days.length > 0 && <div className="text-xs text-slate-600" data-testid="route-info">{t('routeInfo', { days: dayNames(o.rule.days, lang) })}</div>}
              </div>
              <div className="mt-1 text-sm">£{o.listing.pricePerUnit.toFixed(2)} {t('perUnit', { unit: t(`units.${o.product.unit}`) })} · {t('minShort', { n: o.listing.minOrder })}
                {tiers?.map((x) => <span key={x.minQty} className="ml-2 text-brand">{t('tierBreak', { qty: x.minQty, price: x.price.toFixed(2) })}</span>)}
              </div>
              {can ? (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${CONF_STYLE[av.confidence!]}`}>{t(`conf_${av.confidence}`)} · {t('nAvailable', { n: av.orderable })}</span>
                  <input type="number" min={o.listing.minOrder} max={av.orderable} step={1} value={val} aria-label={`${t('quantity')} ${loc(o.product.name)}`}
                    onChange={(e) => setDraft({ ...draft, [id]: e.target.value })} className="w-24 rounded border border-slate-300 px-2 py-1" />
                  <button className="rounded bg-brand px-3 py-1 font-semibold text-white hover:bg-brand-dark"
                    onClick={() => {
                      const n = Math.max(o.listing.minOrder, Math.min(av.orderable, Math.floor(Number(val) || o.listing.minOrder)));
                      onAdd(id, n); setDraft({ ...draft, [id]: String(o.listing.minOrder) });
                    }}>{t('addToCart')}</button>
                  {inCart > 0 && <span className="text-sm font-medium text-emerald-800">{t('inCart', { n: inCart })}</span>}
                </div>
              ) : (
                <p className="mt-2 text-sm" data-testid="why-not">{t(`why_${av.problem as Unavailable}`)}</p>
              )}
            </article>
          );
        })}
      </div>
      {hiddenByRange > 0 && <p className="mt-3 text-sm text-slate-600">{t('hiddenCount', { n: hiddenByRange })}</p>}
    </div>
  );
}
