import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Persona } from '../../shared/types';
import { useOrders, useWindows, type Bootstrap } from '../api';
import { useCart } from '../cart';
import { Browse } from './Browse';
import { CartPanel } from './CartPanel';
import { MyOrders } from './MyOrders';
import { Planner } from './Planner';

type Tab = 'browse' | 'planner' | 'orders';

export function BuyerHome({ me, boot }: { me: Persona; boot: Bootstrap }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('browse');
  const [search, setSearch] = useState('');
  const { cart, setDate, setQty, keepOnly } = useCart(me.id);
  const { data: windows = [], reload: reloadWindows } = useWindows();
  const { data: orders = [], reload: reloadOrders } = useOrders();

  const tabs: [Tab, string][] = [
    ['browse', t('browseTab')],
    ['planner', t('plannerTab')],
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
      {tab === 'orders' && <MyOrders orders={orders} boot={boot} reload={() => { reloadOrders(); reloadWindows(); }} />}
    </div>
  );
}
