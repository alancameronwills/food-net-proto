import { useTranslation } from 'react-i18next';
import type { Order } from '../../shared/types';
import type { Bootstrap } from '../api';
import { fmtDate } from './StockEditor';
import { STATUS_STYLE } from './OrderCard';

/** Operator view: how the network is doing, and every order in it. */
export function Overview({ orders, boot }: { orders: Order[]; boot: Bootstrap }) {
  const { t, i18n } = useTranslation();
  const live = orders.filter((o) => o.status !== 'declined' && o.status !== 'cancelled');
  const finished = orders.filter((o) => o.status === 'delivered' || o.status === 'short');
  const ordered = finished.reduce((n, o) => n + o.lines.reduce((a, l) => a + l.qty, 0), 0);
  const got = finished.reduce((n, o) => n + (o.delivered ?? o.lines).reduce((a, l) => a + l.qty, 0), 0);
  const spend = live.reduce((n, o) => n + (o.deliveredTotal ?? o.total), 0);
  const orgs = new Map(boot.orgs.map((o) => [o.id, o]));

  const tiles: [string, string | number][] = [
    [t('metricOrders'), orders.length],
    [t('metricOpen'), orders.filter((o) => ['placed', 'confirmed', 'picked'].includes(o.status)).length],
    [t('metricDelivered'), finished.length],
    [t('metricDeclined'), orders.length - live.length],
    [t('metricSpend'), `£${spend.toFixed(2)}`],
    [t('metricFill'), ordered ? `${Math.round((got / ordered) * 100)}%` : '–'],
    [t('metricProducers'), new Set(live.map((o) => o.producerId)).size],
    [t('metricListings'), boot.listings.length],
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="metrics">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-2xl font-bold text-brand">{value}</div>
            <div className="text-xs text-slate-600">{label}</div>
          </div>
        ))}
      </div>
      <section>
        <h2 className="mb-2 text-lg font-semibold text-brand-dark">{t('allOrders')}</h2>
        {orders.length === 0 ? <p className="text-slate-600">{t('noOrders')}</p> : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-brand-light text-brand-dark">
                <tr><th className="p-2">{t('orderRef')}</th><th className="p-2">{t('buyerCol')}</th><th className="p-2">{t('producerCol')}</th><th className="p-2">{t('dateCol')}</th><th className="p-2">{t('statusCol')}</th><th className="p-2 text-right">{t('totalCol')}</th></tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-slate-100" data-testid={`overview-${o.id}`}>
                    <td className="p-2 font-mono">{o.id}</td>
                    <td className="p-2">{orgs.get(o.buyerId)?.name}</td>
                    <td className="p-2">{orgs.get(o.producerId)?.name}</td>
                    <td className="p-2">{fmtDate(o.deliveryDate, i18n.language)}</td>
                    <td className="p-2"><span className={`rounded px-2 py-0.5 font-semibold ${STATUS_STYLE[o.status]}`}>{t(`status_${o.status}`)}</span></td>
                    <td className="p-2 text-right">£{(o.deliveredTotal ?? o.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
