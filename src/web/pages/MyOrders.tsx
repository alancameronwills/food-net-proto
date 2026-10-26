import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { capabilities } from '../../shared/models';
import { todayIso } from '../../shared/dates';
import type { Order } from '../../shared/types';
import { api, type Bootstrap } from '../api';
import { OrderCard } from './OrderCard';

/** The buyer's orders, grouped by checkout, updating as producers respond. */
export function MyOrders({ orders, boot, reload }: { orders: Order[]; boot: Bootstrap; reload: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const hub = capabilities(boot.config).consolidatedInvoice;
  const groups = new Map<string, Order[]>();
  for (const o of orders) groups.set(o.groupId, [...(groups.get(o.groupId) ?? []), o]);

  const cancel = async (o: Order) => {
    if (!confirm(t('confirmCancel'))) return;
    try { setError(''); await api(`/orders/${o.id}/cancel`, { method: 'POST' }); reload(); } catch (e) { setError((e as Error).message); }
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
          {group.map((o) => (
            <OrderCard key={o.id} order={o} boot={boot} perspective="buyer" actions={
              (o.status === 'placed' || o.status === 'confirmed') && o.deliveryDate > todayIso() ? (
                <button className="rounded border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50" onClick={() => cancel(o)}>{t('cancelOrder')}</button>
              ) : null
            } />
          ))}
        </section>
      ))}
    </div>
  );
}
