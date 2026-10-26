import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { offersFor } from '../../shared/browse';
import { todayIso } from '../../shared/dates';
import { capabilities } from '../../shared/models';
import { availabilityFor, lineTotal, unitPriceFor, windowKey } from '../../shared/orders';
import type { Order, SupplyWindow } from '../../shared/types';
import { api, type Bootstrap } from '../api';
import { dayNames } from '../../shared/delivery';
import { loc } from '../i18n';
import { longDate } from './Browse';

type Result = { orders: Order[]; failed: { producerId: string; error: string }[] };

/** The basket: re-checks every line against live stock and the delivery date, and places the order. */
export function CartPanel({ buyerId, boot, windows, date, qty, setQty, keepOnly, onPlaced }: {
  buyerId: string; boot: Bootstrap; windows: SupplyWindow[]; date: string; qty: Record<string, number>;
  setQty: (id: string, n: number) => void; keepOnly: (ids: Set<string>) => void; onPlaced: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [placed, setPlaced] = useState<Result>();
  const caps = capabilities(boot.config);
  const today = todayIso();
  const byWindow = useMemo(() => new Map(windows.map((w) => [`${w.listingId}#${w.start}`, w])), [windows]);
  const offers = useMemo(() => new Map(offersFor(buyerId, boot).map((o) => [o.listing.id, o])), [buyerId, boot]);

  const lines = Object.entries(qty).flatMap(([id, n]) => {
    const o = offers.get(id);
    if (!o) return [];
    const av = availabilityFor({ config: boot.config, category: o.category, listing: o.listing, window: byWindow.get(windowKey(id, date)), date, today, driveKm: o.driveKm, rule: o.rule });
    const unit = unitPriceFor(boot.config, o.listing, n);
    const problem = av.problem ? t(`why_${av.problem}`) : n > av.orderable ? t('onlyN', { n: av.orderable }) : n < o.listing.minOrder ? t('minShort', { n: o.listing.minOrder }) : '';
    return [{ id, n, o, unit, problem, total: lineTotal(unit, n) }];
  });
  const producers = [...new Set(lines.map((l) => l.o.producer.id))];
  const total = lines.reduce((n, l) => n + l.total, 0);
  const blocked = lines.some((l) => l.problem);

  const place = async () => {
    setBusy(true); setError('');
    try {
      const r = await api<Result>('/orders', { method: 'POST', body: JSON.stringify({
        deliveryDate: date, note: note.trim() || undefined, lines: lines.map((l) => ({ listingId: l.id, qty: l.n })) }) });
      // Only lines whose producer accepted the order leave the basket
      const failedProducers = new Set(r.failed.map((f) => f.producerId));
      keepOnly(new Set(lines.filter((l) => failedProducers.has(l.o.producer.id)).map((l) => l.id)));
      setPlaced(r); setNote(''); onPlaced();
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
      <p className="text-sm text-slate-600">{longDate(date, i18n.language)}</p>
      {placed && placed.failed.length > 0 && (
        <div role="alert" className="mt-2 rounded bg-red-100 p-2 text-sm text-red-800">
          <b>{t('someFailed')}</b> {t('basketKept')}
          <ul className="list-disc pl-5">{placed.failed.map((f) => <li key={f.producerId}>{boot.orgs.find((x) => x.id === f.producerId)?.name}: {f.error}</li>)}</ul>
        </div>
      )}
      {lines.length === 0 ? <p className="mt-3 text-slate-600">{t('cartEmpty')}</p> : (
        <>
          <div className="mt-2 space-y-3">
            {producers.map((pid) => (
              <div key={pid}>
                <div className="text-sm font-semibold text-slate-700">{lines.find((l) => l.o.producer.id === pid)!.o.producer.name}</div>
                {lines.filter((l) => l.o.producer.id === pid).map((l) => (
                  <div key={l.id} data-testid={`cart-line-${l.id}`} className="border-t border-slate-100 py-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex-1">{loc(l.o.product.name)}</span>
                      <input type="number" min={1} step={1} value={l.n} aria-label={`${t('quantity')} ${loc(l.o.product.name)}`}
                        onChange={(e) => setQty(l.id, Math.max(0, Math.floor(Number(e.target.value) || 0)))} className="w-20 rounded border border-slate-300 px-1 py-0.5" />
                      <span className="w-16 text-right">£{l.total.toFixed(2)}</span>
                      <button aria-label={t('remove')} title={t('remove')} className="px-1 text-slate-500 hover:text-red-700" onClick={() => setQty(l.id, 0)}>×</button>
                    </div>
                    <div className="text-xs text-slate-500">£{l.unit.toFixed(2)} {t('perUnit', { unit: t(`units.${l.o.product.unit}`) })}</div>
                    {l.problem && <div role="alert" className="text-xs font-semibold text-red-700">{t('lineProblem', { why: l.problem })}</div>}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between border-t-2 border-gold pt-2 text-lg font-bold"><span>{t('total')}</span><span data-testid="cart-total">£{total.toFixed(2)}</span></div>
          <ul className="mt-1 text-xs text-slate-600">
            <li>{caps.consolidatedInvoice ? t('invoiceOne') : t('invoicesSeparate', { n: producers.length })}</li>
            <li>{caps.consolidatedDelivery ? t('deliveryOne') : t('deliveriesSeparate', { n: producers.length })}</li>
            <li data-testid="cart-delivery-mode">{t(`deliveryModeNote_${boot.config.delivery}`, { days: dayNames(boot.config.hubDays, i18n.language === 'cy' ? 'cy' : 'en') })}</li>
          </ul>
          <label className="mt-3 block text-sm">{t('noteLabel')}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} className="mt-1 w-full rounded border border-slate-300 p-1" />
          </label>
          {error && <p role="alert" className="mt-2 rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}
          <button disabled={blocked || busy} onClick={place}
            className="mt-3 w-full rounded bg-brand py-2 text-lg font-semibold text-white hover:bg-brand-dark disabled:opacity-50">{busy ? t('placing') : t('placeOrder')}</button>
        </>
      )}
    </aside>
  );
}
