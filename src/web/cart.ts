import { useCallback, useEffect, useState } from 'react';
import { addDays, todayIso } from '../shared/dates';
import { nextWeekday } from '../shared/orders';
import { ctx } from './api';

/**
 * One item in the basket. Each has its own delivery day and its own note for the producer. `useOn` is the day the
 * buyer said they need it for when they added it, which is what its shelf life is measured against.
 */
export type CartLine = { key: string; listingId: string; qty: number; deliveryDate: string; useOn: string; note?: string };
export type Cart = { useOn: string; lines: CartLine[] };

export const lineKey = (listingId: string, deliveryDate: string) => `${listingId}@${deliveryDate}`;

// Thursday is a delivery day for most categories, so it makes a sensible starting date.
const defaultDate = () => nextWeekday(addDays(todayIso(), 3), [4]);
const storageKey = (buyerId: string) => `cart2:${ctx.session}:${buyerId}`;

function load(buyerId: string): Cart {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(buyerId)) ?? 'null') as Cart | null;
    if (saved && Array.isArray(saved.lines) && saved.useOn) {
      return { useOn: saved.useOn > todayIso() ? saved.useOn : defaultDate(), lines: saved.lines.filter((l) => l.deliveryDate > todayIso()) };
    }
    // The older basket kept one day and a quantity per item
    const old = JSON.parse(localStorage.getItem(`cart:${ctx.session}:${buyerId}`) ?? 'null') as { date: string; qty: Record<string, number> } | null;
    if (old?.date && old.date > todayIso()) {
      return { useOn: old.date, lines: Object.entries(old.qty ?? {}).map(([listingId, qty]) => ({ key: lineKey(listingId, old.date), listingId, qty, deliveryDate: old.date, useOn: old.date })) };
    }
  } catch { /* start empty */ }
  return { useOn: defaultDate(), lines: [] };
}

/** A basket that lives in the browser (per session and buyer), so a refresh does not lose it. */
export function useCart(buyerId: string) {
  const [cart, setCart] = useState<Cart>(() => load(buyerId));
  useEffect(() => { localStorage.setItem(storageKey(buyerId), JSON.stringify(cart)); }, [cart, buyerId]);

  const setUseOn = useCallback((useOn: string) => setCart((c) => ({ ...c, useOn })), []);
  /** Add to the basket; the same item for the same delivery day adds to the quantity. */
  const add = useCallback((l: { listingId: string; qty: number; deliveryDate: string; useOn: string; note?: string }) =>
    setCart((c) => {
      const key = lineKey(l.listingId, l.deliveryDate);
      const have = c.lines.find((x) => x.key === key);
      return have
        ? { ...c, lines: c.lines.map((x) => (x.key === key ? { ...x, qty: x.qty + l.qty } : x)) }
        : { ...c, lines: [...c.lines, { key, ...l }] };
    }), []);
  const patch = (key: string, f: (l: CartLine) => CartLine) => setCart((c) => ({ ...c, lines: c.lines.map((l) => (l.key === key ? f(l) : l)) }));
  const setQty = useCallback((key: string, qty: number) =>
    setCart((c) => ({ ...c, lines: qty > 0 ? c.lines.map((l) => (l.key === key ? { ...l, qty } : l)) : c.lines.filter((l) => l.key !== key) })), []);
  const setNote = useCallback((key: string, note: string) => patch(key, (l) => ({ ...l, note: note || undefined })), []);
  /** Move an item to another delivery day; if the same item is already coming that day, the two are combined. */
  const setDeliveryDate = useCallback((key: string, deliveryDate: string) =>
    setCart((c) => {
      const line = c.lines.find((l) => l.key === key);
      if (!line) return c;
      const newKey = lineKey(line.listingId, deliveryDate);
      const other = c.lines.find((l) => l.key === newKey && l.key !== key);
      const rest = c.lines.filter((l) => l.key !== key && l.key !== newKey);
      return { ...c, lines: [...rest, other ? { ...other, qty: other.qty + line.qty, note: other.note ?? line.note } : { ...line, key: newKey, deliveryDate }] };
    }), []);
  const keepOnly = useCallback((keys: Set<string>) => setCart((c) => ({ ...c, lines: c.lines.filter((l) => keys.has(l.key)) })), []);
  return { cart, setUseOn, add, setQty, setNote, setDeliveryDate, keepOnly };
}
