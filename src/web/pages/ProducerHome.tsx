import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { orderableQty } from '../../shared/browse';
import { addDays, mondayOf, todayIso } from '../../shared/dates';
import type { Persona } from '../../shared/types';
import { useOrders, useWindows, type Bootstrap } from '../api';
import { loc } from '../i18n';
import { ListingsEditor } from './ListingsEditor';
import { OrdersInbox } from './OrdersInbox';
import { StockCard } from './StockEditor';

export function ProducerHome({ me, boot, reloadBoot }: { me: Persona; boot: Bootstrap; reloadBoot: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'stock' | 'listings' | 'orders'>('stock');
  const { data: windows = [], reload: reloadWindows } = useWindows();
  const { data: orders = [], reload: reloadOrders } = useOrders();
  const reload = () => { reloadBoot(); reloadWindows(); reloadOrders(); };
  const waiting = orders.filter((o) => o.status === 'placed').length;

  const products = new Map(boot.products.map((p) => [p.id, p]));
  const mine = boot.listings.filter((l) => l.producerId === me.id);
  const mineIds = new Set(mine.map((l) => l.id));
  const myWindows = windows.filter((w) => mineIds.has(w.listingId));

  // Summary tiles. Quantities are in different units (litres, kg, dozen), so count products and weeks instead.
  const monday = mondayOf(todayIso());
  const soon = myWindows.filter((w) => w.start >= monday && w.start < addDays(monday, 28));
  const orderableProducts = mine.filter((l) => soon.some((w) => w.listingId === l.id && orderableQty(boot.config, w) > 0)).length;

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-3">
        {([[t('summaryListings'), mine.length], [t('summaryNext4'), `${orderableProducts} / ${mine.length}`], [t('ordersWaitingTile'), waiting]] as const).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-2xl font-bold text-brand">{value}</div>
            <div className="text-xs text-slate-600">{label}</div>
          </div>
        ))}
      </div>

      <div role="tablist" className="mb-4 flex gap-2 border-b-2 border-gold">
        {(['stock', 'listings', 'orders'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-t px-4 py-2 font-semibold ${tab === k ? 'bg-brand text-white' : 'text-brand hover:bg-brand-light'}`}>
            {k === 'orders' ? `${t('inboxTab')}${waiting ? ` (${waiting})` : ''}` : t(k === 'stock' ? 'tabStock' : 'tabListings')}
          </button>
        ))}
      </div>

      {tab === 'orders' ? (
        <OrdersInbox orders={orders} boot={boot} reload={reload} />
      ) : tab === 'stock' ? (
        <div className="space-y-4">
          {mine.length === 0 && <p className="text-slate-600">{t('noListings')}</p>}
          {mine.map((l) => (
            <StockCard key={l.id} listing={l} product={products.get(l.productId)!} config={boot.config} reload={reload}
              windows={myWindows.filter((w) => w.listingId === l.id)} />
          ))}
        </div>
      ) : (
        <ListingsEditor producerId={me.id} boot={boot} reload={reload} />
      )}
    </div>
  );
}
