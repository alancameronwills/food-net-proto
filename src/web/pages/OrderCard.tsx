import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { lineTotal } from '../../shared/orders';
import type { Order, OrderStatus } from '../../shared/types';
import type { Bootstrap } from '../api';
import { loc } from '../i18n';
import { fmtDate } from './StockEditor';

export const STATUS_STYLE: Record<OrderStatus, string> = {
  placed: 'bg-gold-light text-amber-900',
  confirmed: 'bg-emerald-100 text-emerald-800',
  declined: 'bg-red-100 text-red-800',
  cancelled: 'bg-slate-200 text-slate-700',
};

/** One order: reference, status, who it is with, lines and totals. `actions` slot is for role-specific buttons. */
export function OrderCard({ order, boot, perspective, actions }: {
  order: Order; boot: Bootstrap; perspective: 'buyer' | 'producer'; actions?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const orgs = new Map(boot.orgs.map((o) => [o.id, o]));
  const products = new Map(boot.products.map((p) => [p.id, p]));
  const other = orgs.get(perspective === 'buyer' ? order.producerId : order.buyerId);
  const declined = order.history.find((h) => h.status === 'declined');
  return (
    <article data-testid={`order-${order.id}`} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono font-semibold">{order.id}</span>
        <span data-testid="order-status" className={`rounded px-2 py-0.5 text-sm font-semibold ${STATUS_STYLE[order.status]}`}>{t(`status_${order.status}`)}</span>
        <span className="text-sm text-slate-600">{t(perspective === 'buyer' ? 'from' : 'buyerLabel')}: <b>{other?.name}</b> ({other?.town})</span>
        <span className="ml-auto text-sm text-slate-600">{t('deliveryFor')}: <b>{fmtDate(order.deliveryDate, i18n.language)}</b></span>
      </div>
      <table className="mt-2 w-full text-left text-sm">
        <tbody>
          {order.lines.map((l) => {
            const p = products.get(l.productId);
            return (
              <tr key={l.listingId} className="border-t border-slate-100">
                <td className="py-1">{p ? loc(p.name) : l.productId}</td>
                <td className="py-1">{l.qty} {p ? t(`units.${p.unit}`) : ''}</td>
                <td className="py-1 text-slate-500">£{l.unitPrice.toFixed(2)}</td>
                <td className="py-1 text-right">£{lineTotal(l.unitPrice, l.qty).toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 font-semibold"><td colSpan={3} className="py-1">{t('total')}</td><td className="py-1 text-right">£{order.total.toFixed(2)}</td></tr>
        </tfoot>
      </table>
      {order.note && <p className="mt-1 text-sm italic text-slate-600">“{order.note}”</p>}
      {declined?.note && order.status === 'declined' && <p className="mt-1 text-sm text-red-800">{declined.note}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>{t(`stock_${order.stock}`)}</span>
        {actions && <span className="ml-auto flex gap-2 text-sm">{actions}</span>}
      </div>
    </article>
  );
}
