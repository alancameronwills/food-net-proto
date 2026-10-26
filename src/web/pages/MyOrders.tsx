import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { offersFor } from '../../shared/browse';
import { todayIso } from '../../shared/dates';
import { capabilities } from '../../shared/models';
import { availabilityFor, windowKey } from '../../shared/orders';
import type { Order, SupplyWindow } from '../../shared/types';
import { api, type Bootstrap } from '../api';
import { loc } from '../i18n';
import { OrderCard } from './OrderCard';

/** The buyer's orders, grouped by checkout, updating as producers respond. */
export function MyOrders({ buyerId, orders, boot, windows, reload, onAlternative }: {
  buyerId: string; orders: Order[]; boot: Bootstrap; windows: SupplyWindow[]; reload: () => void;
  onAlternative: (listingId: string, qty: number, date: string) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const hub = capabilities(boot.config).consolidatedInvoice;
  const groups = new Map<string, Order[]>();
  for (const o of orders) groups.set(o.groupId, [...(groups.get(o.groupId) ?? []), o]);
  const products = new Map(boot.products.map((p) => [p.id, p]));

  const post = async (path: string) => {
    try { setError(''); await api(path, { method: 'POST' }); reload(); } catch (e) { setError((e as Error).message); }
  };
  const cancel = (o: Order) => { if (confirm(t('confirmCancel'))) void post(`/orders/${o.id}/cancel`); };

  /** Same product from other producers that could cover the shortfall for this delivery date. */
  const alternativesFor = (o: Order, listingId: string, shortBy: number) => {
    const productId = o.lines.find((l) => l.listingId === listingId)?.productId;
    const byWindow = new Map(windows.map((w) => [`${w.listingId}#${w.start}`, w]));
    return offersFor(buyerId, boot)
      .filter((x) => x.product.id === productId && x.listing.id !== listingId && x.status !== 'hidden')
      .map((x) => ({ x, av: availabilityFor({ config: boot.config, category: x.category, listing: x.listing, window: byWindow.get(windowKey(x.listing.id, o.deliveryDate)),
        date: o.deliveryDate, today: todayIso(), driveKm: x.driveKm, rule: x.rule }) }))
      .filter(({ x, av }) => av.orderable >= Math.max(shortBy, x.listing.minOrder));
  };

  if (orders.length === 0) return <p className="text-slate-600">{t('noOrders')}</p>;
  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}
      {[...groups.values()].map((group) => (
        <section key={group[0].groupId} className="space-y-2">
          {group.length > 1 && (
            <h3 className="text-sm font-semibold text-slate-600">
              {t('checkoutGroup')}: {group.map((o) => o.id).join(', ')}
              {hub && <span className="ml-2 rounded bg-brand-light px-2 py-0.5 text-brand">{t('invoiceOne')} · £{group.reduce((n, o) => n + o.total, 0).toFixed(2)}</span>}
            </h3>
          )}
          {group.map((o) => {
            const flags = (o.status === 'placed' || o.status === 'confirmed') ? o.flags ?? [] : [];
            return (
              <OrderCard key={o.id} order={o} boot={boot} perspective="buyer"
                banner={flags.length > 0 && (
                  <div role="alert" data-testid="supply-cut-banner" className="mt-2 rounded border border-orange-300 bg-orange-50 p-2 text-sm">
                    <b>{t('supplyCutBanner', { what: flags.map((f) => t('supplyCutShort', { product: loc(products.get(o.lines.find((l) => l.listingId === f.listingId)!.productId)!.name), n: f.shortBy })).join('; ') })}</b>
                    {flags.map((f) => {
                      const alts = alternativesFor(o, f.listingId, f.shortBy);
                      return alts.length > 0 && (
                        <div key={f.listingId} className="mt-1">
                          <span className="text-slate-700">{t('alternatives')}: </span>
                          {alts.map(({ x, av }) => (
                            <button key={x.listing.id} data-testid={`alt-${x.listing.id}`} className="mr-2 mt-1 rounded border border-brand px-2 py-0.5 text-brand hover:bg-brand-light"
                              onClick={() => onAlternative(x.listing.id, Math.max(f.shortBy, x.listing.minOrder), o.deliveryDate)}>
                              {x.producer.name} · £{x.listing.pricePerUnit.toFixed(2)} · {t('nAvailable', { n: av.orderable })} → {t('addAlternative')}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
                actions={<>
                  {flags.length > 0 && <button className="rounded border border-emerald-700 px-3 py-1 text-emerald-800 hover:bg-emerald-50" onClick={() => post(`/orders/${o.id}/dismiss-flags`)}>{t('keepOrder')}</button>}
                  {(o.status === 'placed' || o.status === 'confirmed') && o.deliveryDate > todayIso() && (
                    <button className="rounded border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50" onClick={() => cancel(o)}>{t('cancelOrder')}</button>
                  )}
                </>} />
            );
          })}
        </section>
      ))}
    </div>
  );
}
