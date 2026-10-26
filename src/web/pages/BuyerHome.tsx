import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Persona } from '../../shared/types';
import { useOrders, useRequests, useWindows, type Bootstrap } from '../api';
import { capabilities } from '../../shared/models';
import { useCart } from '../cart';
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
  const { cart, setDate, setQty, keepOnly } = useCart(me.id);
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
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_22rem]">
          <Browse buyerId={me.id} boot={boot} windows={windows} date={cart.date} onDate={setDate} qtyInCart={cart.qty}
            onAdd={(id, n) => setQty(id, (cart.qty[id] ?? 0) + n)} search={search} onSearch={setSearch} />
          <CartPanel buyerId={me.id} boot={boot} windows={windows} date={cart.date} qty={cart.qty} setQty={setQty} keepOnly={keepOnly}
            onPlaced={() => { reloadWindows(); reloadOrders(); }} />
        </div>
      )}
      {tab === 'planner' && (
        <Planner buyerId={me.id} boot={boot} windows={windows} onPick={(date, name) => { setDate(date); setSearch(name); setTab('browse'); }} />
      )}
      {tab === 'requests' && (capabilities(boot.config).showDemandBoard ? (
        <RequestsBuyer buyerId={me.id} boot={boot} windows={windows} requests={requests} reload={() => { reloadRequests(); reloadOrders(); reloadWindows(); }}
          onBrowse={(date, name) => { setDate(date); setSearch(name); setTab('browse'); }} />
      ) : <p className="text-slate-600">{t('commitmentsSoon')}</p>)}
      {tab === 'orders' && (
        <MyOrders buyerId={me.id} orders={orders} boot={boot} windows={windows} reload={() => { reloadOrders(); reloadWindows(); }}
          onAlternative={(id, n, date) => { setDate(date); setQty(id, (cart.qty[id] ?? 0) + n); setTab('browse'); }} />
      )}
    </div>
  );
}
