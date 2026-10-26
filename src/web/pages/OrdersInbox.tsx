import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Order } from '../../shared/types';
import { api, type Bootstrap } from '../api';
import { loc } from '../i18n';
import { OrderCard } from './OrderCard';

/** A producer answers new orders here, then works through picking and delivery. */
export function OrdersInbox({ orders, boot, reload }: { orders: Order[]; boot: Bootstrap; reload: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [declining, setDeclining] = useState<string>();
  const [reason, setReason] = useState('');
  const [delivering, setDelivering] = useState<string>();
  const [qty, setQty] = useState<Record<string, string>>({});
  const products = new Map(boot.products.map((p) => [p.id, p]));

  const act = async (id: string, action: string, body?: object) => {
    try {
      setError('');
      await api(`/orders/${id}/${action}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
      setDeclining(undefined);
      setDelivering(undefined);
      setReason('');
      reload();
    } catch (e) {
      setError((e as Error).message);
      reload();
    }
  };

  const startDelivery = (o: Order) => {
    setDelivering(o.id);
    setQty(Object.fromEntries(o.lines.map((l) => [l.listingId, String(l.qty)])));
  };

  const actionsFor = (o: Order) => {
    if (o.status === 'placed') {
      return declining === o.id ? (
        <span className="flex flex-wrap items-center gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('declineReasonLabel')} aria-label={t('declineReasonLabel')}
            className="rounded border border-slate-300 px-2 py-1" />
          <button className="rounded bg-red-700 px-3 py-1 font-semibold text-white" onClick={() => act(o.id, 'decline', { reason })}>{t('confirmDecline')}</button>
          <button className="underline" onClick={() => setDeclining(undefined)}>{t('cancel')}</button>
        </span>
      ) : (
        <>
          <button className="rounded bg-emerald-700 px-4 py-1 font-semibold text-white hover:bg-emerald-800" onClick={() => act(o.id, 'confirm')}>{t('confirm')}</button>
          <button className="rounded border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50" onClick={() => setDeclining(o.id)}>{t('decline')}</button>
        </>
      );
    }
    if (o.status === 'confirmed' || o.status === 'picked') {
      return delivering === o.id ? null : (
        <>
          {o.status === 'confirmed' && <button className="rounded border border-sky-600 px-3 py-1 text-sky-800 hover:bg-sky-50" onClick={() => act(o.id, 'pick')}>{t('markPicked')}</button>}
          <button className="rounded bg-brand px-3 py-1 font-semibold text-white hover:bg-brand-dark" onClick={() => startDelivery(o)}>{t('markDelivered')}</button>
        </>
      );
    }
    return null;
  };

  const banner = (o: Order) => (
    <>
      {(o.flags ?? []).length > 0 && (
        <p data-testid="producer-flag" className="mt-2 rounded bg-orange-50 p-2 text-sm font-semibold text-orange-900">
          {(o.flags ?? []).map((f) => t('supplyCutProducer', { n: f.shortBy })).join('; ')}
        </p>
      )}
      {delivering === o.id && (
        <form className="mt-2 rounded bg-brand-light p-3 text-sm" onSubmit={(e) => {
          e.preventDefault();
          void act(o.id, 'deliver', { lines: o.lines.map((l) => ({ listingId: l.listingId, qty: Math.max(0, Math.floor(Number(qty[l.listingId]) || 0)) })) });
        }}>
          <p className="mb-1 text-xs text-slate-600">{t('demoDeliveryNote')}</p>
          {o.lines.map((l) => (
            <label key={l.listingId} className="mr-4 inline-block">
              {loc(products.get(l.productId)!.name)}
              <input type="number" min={0} max={l.qty} step={1} value={qty[l.listingId] ?? ''} aria-label={`${t('deliveredQty')} ${loc(products.get(l.productId)!.name)}`}
                onChange={(e) => setQty({ ...qty, [l.listingId]: e.target.value })} className="mx-2 w-20 rounded border border-slate-300 bg-white px-2 py-1" />
              {t('ofOrdered', { n: l.qty })}
            </label>
          ))}
          <div className="mt-2 flex gap-3">
            <button className="rounded bg-brand px-3 py-1 font-semibold text-white">{t('recordDelivery')}</button>
            <button type="button" className="underline" onClick={() => setDelivering(undefined)}>{t('cancel')}</button>
          </div>
        </form>
      )}
    </>
  );

  const section = (title: string, list: Order[]) => list.length === 0 ? null : (
    <section className="space-y-2">
      <h3 className="text-lg font-semibold text-brand-dark">{title} ({list.length})</h3>
      {list.map((o) => <OrderCard key={o.id} order={o} boot={boot} perspective="producer" banner={banner(o)} actions={actionsFor(o)} />)}
    </section>
  );

  const by = (...s: Order['status'][]) => orders.filter((o) => s.includes(o.status));
  if (orders.length === 0) return <p className="text-slate-600">{t('noOrders')}</p>;
  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}
      {section(t('needsAnswer'), by('placed'))}
      {section(t('upcomingOrders'), by('confirmed', 'picked').sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)))}
      {section(t('completedOrders'), by('delivered', 'short'))}
      {section(t('pastOrders'), by('declined', 'cancelled'))}
    </div>
  );
}
