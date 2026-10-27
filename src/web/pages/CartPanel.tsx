import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays as addDaysTo, todayIso } from '../../shared/dates';
import { deliverableDates, shelfLifeFor } from '../../shared/availability';
import { offersFor } from '../../shared/browse';
import { dayNames } from '../../shared/delivery';
import { capabilities } from '../../shared/models';
import { availabilityFor, lineTotal, unitPriceFor, windowKey } from '../../shared/orders';
import type { Order, SupplyWindow } from '../../shared/types';
import { api, type Bootstrap } from '../api';
import type { CartLine } from '../cart';
import { duration, shortDate } from '../format';
import { loc } from '../i18n';

// Problems with the day itself (as opposed to stock): there may be another day that works, so the basket moves the item
const DAY_PROBLEMS = ['not_delivery_day', 'not_route_day', 'not_hub_day', 'no_route', 'too_soon', 'too_far'];

type Result = { orders: Order[]; failed: { producerId: string; deliveryDate: string; error: string }[] };

/**
 * The basket. Each item has its own delivery day (chosen from the days it can actually come, within its shelf life
 * for the day it is needed) and its own note for the producer. Every item is re-checked against live stock, and
 * the checkout becomes one order per producer and day.
 */
export function CartPanel({ buyerId, boot, windows, lines: cartLines, setQty, setNote, setDeliveryDate, keepOnly, onPlaced }: {
  buyerId: string; boot: Bootstrap; windows: SupplyWindow[]; lines: CartLine[];
  setQty: (key: string, n: number) => void; setNote: (key: string, note: string) => void; setDeliveryDate: (key: string, date: string) => void;
  keepOnly: (keys: Set<string>) => void; onPlaced: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [placed, setPlaced] = useState<Result>();
  const caps = capabilities(boot.config);
  const today = todayIso();
  const byWindow = useMemo(() => new Map(windows.map((w) => [`${w.listingId}#${w.start}`, w])), [windows]);
  const offers = useMemo(() => new Map(offersFor(buyerId, boot).map((o) => [o.listing.id, o])), [buyerId, boot]);

  const lines = cartLines.flatMap((c) => {
    const o = offers.get(c.listingId);
    if (!o) return [];
    const shelf = shelfLifeFor(o.category, o.listing);
    const days = deliverableDates({ config: boot.config, category: o.category, listing: o.listing, rule: o.rule, driveKm: o.driveKm, windows: byWindow, today });
    // The days this item could arrive and still be good for the day it is needed
    const options = days.filter((d) => d.date <= c.useOn && d.date >= addDaysTo(c.useOn, -shelf)).map((d) => d.date);
    const av = availabilityFor({ config: boot.config, category: o.category, listing: o.listing, window: byWindow.get(windowKey(c.listingId, c.deliveryDate)), date: c.deliveryDate, today, driveKm: o.driveKm, rule: o.rule });
    const unit = unitPriceFor(boot.config, o.listing, c.qty);
    const dayProblemNoAlt = !!av.problem && DAY_PROBLEMS.includes(av.problem) && options.length === 0;
    const problem = dayProblemNoAlt ? t('lineNoDay', { date: shortDate(c.useOn, i18n.language) }) : av.problem ? t(`why_${av.problem}`) : c.qty > av.orderable ? t('onlyN', { n: av.orderable }) : c.qty < o.listing.minOrder ? t('minShort', { n: o.listing.minOrder }) : '';
    // The delivery day itself has stopped working (a changed round, an old basket): the nearest day that does is available
    const dayProblem = !!av.problem && DAY_PROBLEMS.includes(av.problem);
    const moveTo = dayProblem && options.length > 0 ? options[options.length - 1] : undefined;
    return [{ c, o, shelf, options: options.includes(c.deliveryDate) ? options : [c.deliveryDate, ...options].sort(), unit, problem, moveTo, total: lineTotal(unit, c.qty) }];
  });
  // Move any item whose delivery day no longer works, and say so
  const [moved, setMoved] = useState<{ id: string; name: string; from: string; to: string; useOn: string }[]>([]);
  const toMove = lines.filter((l) => l.moveTo).map((l) => `${l.c.key}>${l.moveTo}`).join(',');
  useEffect(() => {
    const done: typeof moved = [];
    for (const l of lines) {
      if (!l.moveTo) continue;
      setDeliveryDate(l.c.key, l.moveTo);
      done.push({ id: l.c.key, name: loc(l.o.product.name), from: l.c.deliveryDate, to: l.moveTo, useOn: l.c.useOn });
    }
    if (done.length) setMoved((m) => [...m, ...done]);
  }, [toMove]); // eslint-disable-line react-hooks/exhaustive-deps
  const producers = [...new Set(lines.map((l) => l.o.producer.id))];
  const orderKeys = new Set(lines.map((l) => `${l.o.producer.id}|${l.c.deliveryDate}`));
  const days = new Set(lines.map((l) => l.c.deliveryDate));
  const total = lines.reduce((n, l) => n + l.total, 0);
  const blocked = lines.some((l) => l.problem);

  const place = async () => {
    setBusy(true); setError('');
    try {
      const r = await api<Result>('/orders', { method: 'POST', body: JSON.stringify({
        lines: lines.map((l) => ({ listingId: l.c.listingId, qty: l.c.qty, deliveryDate: l.c.deliveryDate, note: l.c.note })) }) });
      // Only items whose order was refused stay in the basket
      const failed = new Set(r.failed.map((f) => `${f.producerId}|${f.deliveryDate}`));
      keepOnly(new Set(lines.filter((l) => failed.has(`${l.o.producer.id}|${l.c.deliveryDate}`)).map((l) => l.c.key)));
      setPlaced(r); onPlaced();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  if (placed && lines.length === 0) {
    return (
      <aside data-testid="cart" className="rounded-lg border-2 border-emerald-500 bg-emerald-50 p-4">
        <h2 className="text-lg font-bold text-emerald-900">{t('orderPlaced')}</h2>
        <p data-testid="placed-refs" className="font-mono">{placed.orders.map((o) => o.id).join(', ')}</p>
        <p className="mt-1 text-sm">{t('orderPlacedHint')}</p>
        <button className="mt-3 rounded bg-brand px-3 py-1.5 font-semibold text-white" onClick={() => setPlaced(undefined)}>OK</button>
      </aside>
    );
  }

  return (
    <aside data-testid="cart" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-4">
      <h2 className="text-lg font-bold text-brand">{t('cart')}</h2>
      {moved.length > 0 && (
        <div role="status" data-testid="moved-notice" className="mt-2 rounded bg-sky-50 p-2 text-sm text-sky-900">
          <ul className="list-disc pl-5">
            {moved.map((m) => <li key={m.id + m.from}>{t('movedLine', { name: m.name, from: shortDate(m.from, i18n.language), to: shortDate(m.to, i18n.language), use: shortDate(m.useOn, i18n.language) })}</li>)}
          </ul>
          <button className="mt-1 text-xs underline" onClick={() => setMoved([])}>{t('dismiss')}</button>
        </div>
      )}
      {placed && placed.failed.length > 0 && (
        <div role="alert" className="mt-2 rounded bg-red-100 p-2 text-sm text-red-800">
          <b>{t('someFailed')}</b> {t('basketKept')}
          <ul className="list-disc pl-5">{placed.failed.map((f) => <li key={f.producerId + f.deliveryDate}>{boot.orgs.find((x) => x.id === f.producerId)?.name} ({shortDate(f.deliveryDate, i18n.language)}): {f.error}</li>)}</ul>
        </div>
      )}
      {lines.length === 0 ? <p className="mt-3 text-slate-600">{t('cartEmpty')}</p> : (
        <>
          <div className="mt-2 space-y-3">
            {producers.map((pid) => (
              <div key={pid}>
                <div className="text-sm font-semibold text-slate-700">{lines.find((l) => l.o.producer.id === pid)!.o.producer.name}</div>
                {lines.filter((l) => l.o.producer.id === pid).map((l) => (
                  <div key={l.c.key} data-testid={`cart-line-${l.c.listingId}`} className="border-t border-slate-100 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex-1">{loc(l.o.product.name)}</span>
                      <input type="number" min={1} step={1} value={l.c.qty} aria-label={`${t('quantity')} ${loc(l.o.product.name)}`}
                        onChange={(e) => setQty(l.c.key, Math.max(0, Math.floor(Number(e.target.value) || 0)))} className="w-20 rounded border border-slate-300 px-1 py-0.5" />
                      <span className="w-16 text-right">£{l.total.toFixed(2)}</span>
                      <button aria-label={t('remove')} title={t('remove')} className="px-1 text-slate-500 hover:text-red-700" onClick={() => setQty(l.c.key, 0)}>×</button>
                    </div>
                    <div className="text-xs text-slate-500">£{l.unit.toFixed(2)} {t('perUnit', { unit: t(`units.${l.o.product.unit}`) })}</div>
                    <label className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-700">{t('deliverOn')}
                      <select value={l.c.deliveryDate} aria-label={`${t('deliverOn')} ${loc(l.o.product.name)}`} data-testid="line-date" onChange={(e) => setDeliveryDate(l.c.key, e.target.value)}
                        className="rounded border border-slate-300 bg-white px-1 py-0.5">
                        {l.options.map((d) => <option key={d} value={d}>{shortDate(d, i18n.language)}</option>)}
                      </select>
                      <span className="text-slate-500" data-testid="line-use">{t('forUseOn', { date: shortDate(l.c.useOn, i18n.language), time: duration(t, l.shelf) })}</span>
                    </label>
                    <input value={l.c.note ?? ''} maxLength={300} placeholder={t('lineNotePlaceholder')} aria-label={`${t('lineNote')} ${loc(l.o.product.name)}`}
                      onChange={(e) => setNote(l.c.key, e.target.value)} className="mt-1 w-full rounded border border-slate-200 px-2 py-0.5 text-xs" />
                    {l.problem && <div role="alert" className="text-xs font-semibold text-red-700">{t('lineProblem', { why: l.problem })}</div>}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between border-t-2 border-gold pt-2 text-lg font-bold"><span>{t('total')}</span><span data-testid="cart-total">£{total.toFixed(2)}</span></div>
          <ul className="mt-1 text-xs text-slate-600">
            <li>{caps.consolidatedInvoice ? t('invoiceOne') : producers.length === 1 ? t('invoiceSingle') : t('invoicesSeparate', { n: producers.length })}</li>
            <li data-testid="cart-deliveries">{caps.consolidatedDelivery
              ? (days.size === 1 ? t('deliveryOne') : t('deliveriesHubMany', { n: days.size }))
              : orderKeys.size === 1 ? t('deliverySingle') : t('deliveriesSeparate', { n: orderKeys.size })}</li>
            <li data-testid="cart-delivery-mode">{t(`deliveryModeNote_${boot.config.delivery}`, { days: dayNames(boot.config.hubDays, i18n.language === 'cy' ? 'cy' : 'en') })}</li>
          </ul>
          {error && <p role="alert" className="mt-2 rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}
          <button disabled={blocked || busy} onClick={place}
            className="mt-3 w-full rounded bg-brand py-2 text-lg font-semibold text-white hover:bg-brand-dark disabled:opacity-50">{busy ? t('placing') : t('placeOrder')}</button>
        </>
      )}
    </aside>
  );
}
