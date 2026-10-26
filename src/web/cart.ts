import { useCallback, useEffect, useState } from 'react';
import { addDays, todayIso } from '../shared/dates';
import { nextWeekday } from '../shared/orders';
import { ctx } from './api';

export type Cart = { date: string; qty: Record<string, number> };

// Thursday is a delivery day for most categories, so it makes a sensible starting date.
const defaultDate = () => nextWeekday(addDays(todayIso(), 3), [4]);
const key = (buyerId: string) => `cart:${ctx.session}:${buyerId}`;

/** A basket that lives in the browser (per session and buyer), so a refresh does not lose it. */
export function useCart(buyerId: string) {
  const [cart, setCart] = useState<Cart>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key(buyerId)) ?? 'null') as Cart | null;
      if (saved?.date && saved.qty && saved.date > todayIso()) return saved;
    } catch { /* fall through */ }
    return { date: defaultDate(), qty: {} };
  });
  useEffect(() => { localStorage.setItem(key(buyerId), JSON.stringify(cart)); }, [cart, buyerId]);

  const setDate = useCallback((date: string) => setCart((c) => ({ ...c, date })), []);
  const setQty = useCallback((listingId: string, qty: number) =>
    setCart((c) => {
      const next = { ...c.qty };
      if (qty > 0) next[listingId] = qty; else delete next[listingId];
      return { ...c, qty: next };
    }), []);
  const clear = useCallback(() => setCart((c) => ({ ...c, qty: {} })), []);
  const keepOnly = useCallback((ids: Set<string>) =>
    setCart((c) => ({ ...c, qty: Object.fromEntries(Object.entries(c.qty).filter(([id]) => ids.has(id))) })), []);
  return { cart, setDate, setQty, clear, keepOnly };
}
