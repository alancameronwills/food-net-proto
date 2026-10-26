import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Order } from '../../shared/types';
import { api, type Bootstrap } from '../api';
import { OrderCard } from './OrderCard';

/** A producer answers new orders here, then sees what is coming up. */
export function OrdersInbox({ orders, boot, reload }: { orders: Order[]; boot: Bootstrap; reload: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [declining, setDeclining] = useState<string>();
  const [reason, setReason] = useState('');

  const act = async (id: string, action: 'confirm' | 'decline', body?: object) => {
    try {
      setError('');
      await api(`/orders/${id}/${action}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
      setDeclining(undefined);
      setReason('');
      reload();
    } catch (e) {
      setError((e as Error).message);
      reload();
    }
  };

  const waiting = orders.filter((o) => o.status === 'placed');
  const upcoming = orders.filter((o) => o.status === 'confirmed').sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
  const past = orders.filter((o) => o.status === 'declined' || o.status === 'cancelled');

  const section = (title: string, list: Order[], withActions = false) => list.length === 0 ? null : (
    <section className="space-y-2">
      <h3 className="text-lg font-semibold text-brand-dark">{title} ({list.length})</h3>
      {list.map((o) => (
        <OrderCard key={o.id} order={o} boot={boot} perspective="producer" actions={withActions ? (
          declining === o.id ? (
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
          )
        ) : undefined} />
      ))}
    </section>
  );

  if (orders.length === 0) return <p className="text-slate-600">{t('noOrders')}</p>;
  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}
      {section(t('needsAnswer'), waiting, true)}
      {section(t('upcomingOrders'), upcoming)}
      {section(t('pastOrders'), past)}
    </div>
  );
}
