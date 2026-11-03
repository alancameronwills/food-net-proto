import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { orderableQty } from '../../shared/browse';
import { addDays, mondayOf, todayIso } from '../../shared/dates';
import type { Persona } from '../../shared/types';
import { useOrders, useRequests, useWindows, type Bootstrap } from '../api';
import { capabilities } from '../../shared/models';
import { loc } from '../i18n';
import { ListingsEditor } from './ListingsEditor';
import { useScreen } from '../screen';
import { DemandBoard } from './DemandBoard';
import { ExtraDays } from './ExtraDays';
import { OrdersInbox } from './OrdersInbox';
import { StockTable } from './StockEditor';
import { StockCard } from './StockCards';

export function ProducerHome({ me, boot, reloadBoot }: { me: Persona; boot: Bootstrap; reloadBoot: () => unknown }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'stock' | 'listings' | 'orders' | 'demand'>('stock');
  useScreen(`producer/${tab}`);
  const [layout, setLayoutState] = useState<'table' | 'cards'>(() => localStorage.getItem('stockLayout') === 'cards' ? 'cards' : 'table');
  const setLayout = (l: 'table' | 'cards') => { setLayoutState(l); localStorage.setItem('stockLayout', l); };
  const { data: windows = [], reload: reloadWindows } = useWindows();
  const { data: orders = [], reload: reloadOrders } = useOrders();
  const { data: requests = [], reload: reloadRequests } = useRequests();
  const reload = () => Promise.all([reloadBoot(), reloadWindows(), reloadOrders(), reloadRequests()]);
  // If the operator switches demand requests off while this tab is open, go back to the stock screen
  useEffect(() => { if (!boot.config.demandOn && tab === 'demand') setTab('stock'); }, [boot.config.demandOn, tab]);
  const unanswered = requests.filter((r) => r.status === 'open' && !r.bids.some((b) => b.status === 'open')).length;
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
        {(['stock', 'listings', 'orders', 'demand'] as const).filter((k) => k !== 'demand' || boot.config.demandOn).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-t px-4 py-2 font-semibold ${tab === k ? 'bg-brand text-white' : 'text-brand hover:bg-brand-light'}`}>
            {k === 'orders' ? `${t('inboxTab')}${waiting ? ` (${waiting})` : ''}` : k === 'demand' ? `${t('demandTab')}${unanswered ? ` (${unanswered})` : ''}` : t(k === 'stock' ? 'tabStock' : 'tabListings')}
          </button>
        ))}
      </div>

      {tab === 'demand' ? (
        capabilities(boot.config).showDemandBoard
          ? <DemandBoard producerId={me.id} boot={boot} requests={requests} reload={reload} />
          : <p className="text-slate-600">{t('commitmentsSoon')}</p>
      ) : tab === 'orders' ? (
        <div className="space-y-6">
          <ExtraDays producerId={me.id} boot={boot} reload={reload} />
          <OrdersInbox orders={orders} boot={boot} reload={reload} producerId={me.id} />
        </div>
      ) : tab === 'stock' ? (
        <div>
          <div className="mb-2 flex items-center justify-end gap-2 text-sm text-slate-600">
            <span id="stock-layout-label">{t('stockLayout')}</span>
            <div role="group" aria-labelledby="stock-layout-label" className="inline-flex overflow-hidden rounded border border-brand">
              {(['table', 'cards'] as const).map((l) => (
                <button key={l} aria-pressed={layout === l} onClick={() => setLayout(l)}
                  className={`px-3 py-1 font-medium ${layout === l ? 'bg-brand text-white' : 'text-brand hover:bg-brand-light'}`}>{t(l === 'table' ? 'layoutTable' : 'layoutCards')}</button>
              ))}
            </div>
          </div>
          {mine.length === 0 ? <p className="text-slate-600">{t('noListings')}</p>
            : layout === 'table'
              ? <StockTable listings={mine} products={products} windows={myWindows} config={boot.config} reload={reload} />
              : <div className="space-y-4">{mine.map((l) => (
                <StockCard key={l.id} listing={l} product={products.get(l.productId)!} config={boot.config} reload={reload}
                  windows={myWindows.filter((w) => w.listingId === l.id)} />
              ))}</div>}
        </div>
      ) : (
        <ListingsEditor producerId={me.id} boot={boot} reload={reload} />
      )}
    </div>
  );
}
