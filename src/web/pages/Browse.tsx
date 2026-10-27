import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { availableForUse, deliverableDates, shelfLifeFor, type Deliverable } from '../../shared/availability';
import { offersFor } from '../../shared/browse';
import { addDays, todayIso } from '../../shared/dates';
import { dayNames, WEEKDAYS } from '../../shared/delivery';
import { capabilities } from '../../shared/models';
import type { SupplyWindow } from '../../shared/types';
import type { Bootstrap } from '../api';
import { duration, shortDate } from '../format';
import { loc } from '../i18n';
import { CONF_STYLE } from './StockEditor';
import { TrustChip } from './TrustChip';

export const longDate = (iso: string, lang: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString(lang === 'cy' ? 'cy-GB' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * The whole catalogue, whatever the date. Choosing a day shows which things can be had for it: delivered on a day the
 * producer can deliver, no longer ago than the product's shelf life. Everything else shows the nearest days that work.
 */
export function Browse({ buyerId, boot, windows, useOn, onUseOn, qtyInCart, onAdd, search, onSearch }: {
  buyerId: string; boot: Bootstrap; windows: SupplyWindow[]; useOn: string; onUseOn: (d: string) => void;
  qtyInCart: Record<string, number>; onAdd: (listingId: string, qty: number, deliveryDate: string, useOn: string) => void;
  search: string; onSearch: (s: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [category, setCategory] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const caps = capabilities(boot.config);
  const today = todayIso();
  const lang = i18n.language === 'cy' ? 'cy' : 'en';

  const byWindow = useMemo(() => new Map(windows.map((w) => [`${w.listingId}#${w.start}`, w])), [windows]);
  const all = useMemo(() => offersFor(buyerId, boot), [buyerId, boot]);
  const offers = useMemo(() => all.filter((o) => o.status !== 'hidden'), [all]);
  const hiddenByRange = all.length - offers.length;

  // For each product, every day it could be delivered with stock: the basis for everything below
  const deliverable = useMemo(() => new Map<string, Deliverable[]>(offers.map((o) => [o.listing.id, deliverableDates({
    config: boot.config, category: o.category, listing: o.listing, rule: o.rule, driveKm: o.driveKm, windows: byWindow, today,
  })])), [offers, boot.config, byWindow, today]);

  const rows = useMemo(() => offers.map((o) => {
    const shelf = shelfLifeFor(o.category, o.listing);
    return { o, shelf, use: availableForUse(deliverable.get(o.listing.id) ?? [], shelf, useOn) };
  }), [offers, deliverable, useOn]);

  // How many things could be had for each of the next two weeks of days
  const strip = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = addDays(today, i + 1);
    return { d, n: offers.filter((o) => availableForUse(deliverable.get(o.listing.id) ?? [], shelfLifeFor(o.category, o.listing), d).ok).length };
  }), [offers, deliverable, today]);

  const q = search.trim().toLowerCase();
  const shown = rows
    .filter(({ o, use }) => (!category || o.category.id === category) && (!onlyAvailable || use.ok)
      && (!q || `${o.product.name.en} ${o.product.name.cy} ${o.producer.name}`.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.use.ok) - Number(a.use.ok) || a.o.category.id.localeCompare(b.o.category.id) || a.o.driveKm - b.o.driveKm);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <label className="text-sm font-medium">{t('neededOn')}
          <input type="date" value={useOn} min={addDays(today, 1)} max={addDays(today, 180)} onChange={(e) => e.target.value && onUseOn(e.target.value)}
            className="ml-2 rounded border border-slate-300 px-2 py-1 text-base" aria-label={t('neededOn')} />
        </label>
        <span className="text-lg font-semibold text-brand" data-testid="delivery-long">{longDate(useOn, i18n.language)}</span>
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
              <button key={d} data-testid={`day-${d}`} data-count={n} onClick={() => onUseOn(d)} aria-pressed={d === useOn}
                className={`min-w-16 shrink-0 rounded border px-2 py-1 text-center text-xs ${d === useOn ? 'border-brand bg-brand text-white' : n > 0 ? 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100' : 'border-slate-200 bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                <div className="font-semibold">{WEEKDAYS[lang][dt.getUTCDay()]} {dt.getUTCDate()}</div>
                <div>{n > 0 ? t('dayCount', { n }) : '–'}</div>
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 && <p className="text-slate-600">{t('noMatches')}</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map(({ o, use, shelf }) => {
          const id = o.listing.id;
          const inCart = qtyInCart[id] ?? 0;
          const val = draft[id] ?? String(o.listing.minOrder);
          const tiers = caps.volumeTiers ? o.listing.tiers : undefined;
          const best = use.ok ? use.best : undefined;
          return (
            <article key={id} data-testid={`offer-${id}`} data-available={use.ok} className={`rounded-lg border p-3 shadow-sm ${use.ok ? 'border-emerald-300 bg-white' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-lg font-semibold">{loc(o.product.name)}</h3>
                <span className="text-xs">{loc(o.category.name)}</span>
                {o.listing.certifications.map((c) => <span key={c} className="rounded bg-emerald-100 px-1.5 text-xs text-emerald-800">{c}</span>)}
              </div>
              <div className="text-sm">{o.producer.name} · {o.producer.town} · {t('km', { n: o.driveKm })}
                {best?.farWarning && <span className="ml-2 rounded bg-gold-light px-1.5 text-xs font-semibold text-amber-900">{t('farWarning')}</span>}
                <span className="ml-2"><TrustChip producerId={o.producer.id} boot={boot} /></span>
                {o.rule.mode === 'area_days' && o.rule.days.length > 0 && <div className="text-xs text-slate-600" data-testid="route-info">{t('routeInfo', { days: dayNames(o.rule.days, lang) })}</div>}
              </div>
              <div className="mt-1 text-sm">£{o.listing.pricePerUnit.toFixed(2)} {t('perUnit', { unit: t(`units.${o.product.unit}`) })} · {t('minShort', { n: o.listing.minOrder })}
                {tiers?.map((x) => <span key={x.minQty} className="ml-2 text-brand">{t('tierBreak', { qty: x.minQty, price: x.price.toFixed(2) })}</span>)}
              </div>
              <div className="text-xs text-slate-500" data-testid="shelf-life">{t('shelfLifeLine', { time: duration(t, shelf) })}</div>

              {best ? (
                <div className="mt-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span data-testid="stock-flag" className={`rounded border px-2 py-0.5 text-xs font-semibold ${CONF_STYLE[best.confidence]}`}>✓ {t(`conf_${best.confidence}`)}</span>
                    <span data-testid="delivered-on">{t('deliveredOn', { date: shortDate(best.date, i18n.language) })}</span>
                    {best.special && <span data-testid="special-tag" className="rounded bg-sky-100 px-1.5 text-xs text-sky-900">{t('specialDelivery')}</span>}
                    <span className="text-xs text-slate-600">{t('nAvailable', { n: best.orderable })}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <input type="number" min={o.listing.minOrder} max={best.orderable} step={1} value={val} aria-label={`${t('quantity')} ${loc(o.product.name)}`}
                      onChange={(e) => setDraft({ ...draft, [id]: e.target.value })} className="w-24 rounded border border-slate-300 px-2 py-1" />
                    <button className="rounded bg-brand px-3 py-1 font-semibold text-white hover:bg-brand-dark"
                      onClick={() => {
                        const n = Math.max(o.listing.minOrder, Math.min(best.orderable, Math.floor(Number(val) || o.listing.minOrder)));
                        onAdd(id, n, best.date, useOn); setDraft({ ...draft, [id]: String(o.listing.minOrder) });
                      }}>{t('addToCart')}</button>
                    {inCart > 0 && <span className="text-sm font-medium text-emerald-800">{t('inCart', { n: inCart })}</span>}
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-sm" data-testid="why-not">
                  <div>{t('notAvailableFor', { date: shortDate(useOn, i18n.language) })}</div>
                  {!use.ok && (use.earlier || use.later) ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="nearest">
                      <span className="text-xs">{t('nearestDays')}</span>
                      {use.earlier && <button data-testid="nearest-earlier" className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-100" onClick={() => onUseOn(use.earlier!)}>← {shortDate(use.earlier, i18n.language)}</button>}
                      {use.later && <button data-testid="nearest-later" className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-100" onClick={() => onUseOn(use.later!)}>{shortDate(use.later, i18n.language)} →</button>}
                    </div>
                  ) : <div className="mt-1 text-xs" data-testid="nearest-none">{t('noSupplySoon')}</div>}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {hiddenByRange > 0 && <p className="mt-3 text-sm text-slate-600">{t('hiddenCount', { n: hiddenByRange })}</p>}
    </div>
  );
}
