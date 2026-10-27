import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Persona } from '../../shared/types';
import { useOrders, useRequests, useWindows, type Bootstrap } from '../api';
import { capabilities } from '../../shared/models';
import { useCart } from '../cart';
import { useScreen } from '../screen';
import { Browse } from './Browse';
import { CartPanel } from './CartPanel';
import { MyOrders } from './MyOrders';
import { Planner } from './Planner';
import { RequestsBuyer } from './RequestsBuyer';

type Tab = 'browse' | 'planner' | 'requests' | 'orders';

export function BuyerHome({ me, boot }: { me: Persona; boot: Bootstrap }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('browse');
  const [search, setSearch] = useState('');
  useScreen(`buyer/${tab}`);
  const { cart, setUseOn, add, setQty, setNote, setDeliveryDate, keepOnly } = useCart(me.id);
  const qtyByListing: Record<string, number> = {};
  for (const l of cart.lines) qtyByListing[l.listingId] = (qtyByListing[l.listingId] ?? 0) + l.qty;
  const { data: windows = [], reload: reloadWindows } = useWindows();
  const { data: orders = [], reload: reloadOrders } = useOrders();
  const { data: requests = [], reload: reloadRequests } = useRequests();
  const openRequests = requests.filter((r) => r.status === 'open').length;

  const tabs: [Tab, string][] = [
    ['browse', t('browseTab')],
    ['planner', t('plannerTab')],
    ['requests', `${t('requestsTab')}${openRequests ? ` (${openRequests})` : ''}`],
    ['orders', `${t('ordersTab')}${orders.length ? ` (${orders.length})` : ''}`],
  ];
  return (
    <div>
      <div role="tablist" className="mb-4 flex gap-2 border-b-2 border-gold">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-t px-4 py-2 font-semibold ${tab === k ? 'bg-brand text-white' : 'text-brand hover:bg-brand-light'}`}>{label}</button>
        ))}
      </div>

      {tab === 'browse' && (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Browse buyerId={me.id} boot={boot} windows={windows} useOn={cart.useOn} onUseOn={setUseOn} qtyInCart={qtyByListing}
            onAdd={(listingId, qty, deliveryDate, useOn) => add({ listingId, qty, deliveryDate, useOn })} search={search} onSearch={setSearch} />
          <CartPanel buyerId={me.id} boot={boot} windows={windows} lines={cart.lines} setQty={setQty} setNote={setNote} setDeliveryDate={setDeliveryDate} keepOnly={keepOnly}
            onPlaced={() => { reloadWindows(); reloadOrders(); }} />
        </div>
      )}
      {tab === 'planner' && (
        <Planner buyerId={me.id} boot={boot} windows={windows} onPick={(date, name) => { setUseOn(date); setSearch(name); setTab('browse'); }} />
      )}
      {tab === 'requests' && (capabilities(boot.config).showDemandBoard ? (
        <RequestsBuyer buyerId={me.id} boot={boot} windows={windows} requests={requests} reload={() => { reloadRequests(); reloadOrders(); reloadWindows(); }}
          onBrowse={(date, name) => { setUseOn(date); setSearch(name); setTab('browse'); }} />
      ) : <p className="text-slate-600">{t('commitmentsSoon')}</p>)}
      {tab === 'orders' && (
        <MyOrders buyerId={me.id} orders={orders} boot={boot} windows={windows} reload={() => { reloadOrders(); reloadWindows(); }}
          onAlternative={(id, n, date) => { setUseOn(date); add({ listingId: id, qty: n, deliveryDate: date, useOn: date }); setTab('browse'); }} />
      )}
    </div>
  );
}
