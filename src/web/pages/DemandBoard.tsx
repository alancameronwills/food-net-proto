import { useRef, useState } from 'react';
import { addDays, todayIso } from '../../shared/dates';
import { useTranslation } from 'react-i18next';
import type { Bid, RequestView } from '../../shared/types';
import { api, type Bootstrap } from '../api';
import { bidFit, isSpecialDelivery } from '../delivery-info';
import { duration, shortDate } from '../format';
import { loc } from '../i18n';
import { requestedAs, isOther } from '../requested';
import { longDate } from './Browse';

const input = 'rounded border border-slate-300 bg-white px-2 py-1';

/** What local buyers are asking for. Producers bid (sealed), or accept the buyer's price under first-to-accept. */
export function DemandBoard({ producerId, boot, requests, reload }: { producerId: string; boot: Bootstrap; requests: RequestView[]; reload: () => unknown }) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState('');
  const model = boot.config.speculative;
  // A request whose day has passed is out of the running, unless this producer still has a bid on it to withdraw
  const live = (r: RequestView) => r.status === 'open' && (!r.expired || r.bids.some((b) => b.status === 'open'));
  const open = requests.filter(live);
  const decided = requests.filter((r) => !live(r));

  // One action at a time for each request, held until the screen has been refreshed: a double click must not send twice
  const acting = useRef(new Set<string>());
  const [working, setWorking] = useState<string[]>([]);
  const run = async (key: string, f: () => Promise<unknown>) => {
    if (acting.current.has(key)) return false;
    acting.current.add(key); setWorking([...acting.current]);
    try { setError(''); await f(); await reload(); return true; } catch (e) { setError((e as Error).message); await reload(); return false; }
    finally { acting.current.delete(key); setWorking([...acting.current]); }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-600">{t('demandIntro')}</p>
      {error && <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}
      {open.length === 0 && <p className="text-slate-600">{t('demandNone')}</p>}
      {open.map((r) => <RequestCard key={r.id} r={r} boot={boot} producerId={producerId} model={model} run={(f) => run(r.id, f)} working={working.includes(r.id)} lang={i18n.language} />)}

      {decided.length > 0 && (
        <section className="space-y-2 pt-2">
          <h3 className="text-lg font-semibold text-brand-dark">{t('decidedHeading')} ({decided.length})</h3>
          {decided.map((r) => {
            const asked = requestedAs(boot, r.productId, t);
            const mine = r.bids.find((b) => b.status === 'accepted') ?? r.bids[r.bids.length - 1];
            return (
              <div key={r.id} data-testid={`decided-${r.id}`} className="flex flex-wrap items-center gap-x-4 rounded border border-slate-200 bg-white p-3 text-sm">
                <span className="font-mono font-semibold">{r.id}</span>
                <span>{asked.name} · {r.qty} {asked.unit}</span>
                <span className="text-slate-500">{longDate(r.deliveryDate, i18n.language)}</span>
                <span className={`ml-auto font-semibold ${mine?.status === 'accepted' ? 'text-emerald-800' : 'text-slate-500'}`}>
                  {mine?.status === 'accepted' ? t('outcomeWon', { id: mine.orderId }) : r.expired ? t('outcomeExpired') : r.status === 'closed' ? t('outcomeClosed') : t('outcomeLost')}
                </span>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

function RequestCard({ r, boot, producerId, model, run, working, lang }: {
  r: RequestView; boot: Bootstrap; producerId: string; model: string; run: (f: () => Promise<unknown>) => Promise<boolean>; working: boolean; lang: string;
}) {
  const { t } = useTranslation();
  const asked = requestedAs(boot, r.productId, t);
  const buyer = boot.orgs.find((o) => o.id === r.buyerId) ?? { name: r.buyerId, town: '' };
  const km = boot.distances[r.buyerId]?.[producerId];
  const mine: Bid | undefined = r.bids.find((b) => b.producerId === producerId && b.status === 'open');
  // What is offered: the item asked for if this producer has it, else they must choose (always from their own products,
  // or the item asked for). It need not be what the buyer asked for
  const myProducts = boot.listings.filter((l) => l.producerId === producerId).map((l) => boot.products.find((x) => x.id === l.productId)!).filter(Boolean);
  const choices = asked.product && !myProducts.some((x) => x.id === asked.product!.id) ? [...myProducts, asked.product] : myProducts;
  const sells = (id: string) => boot.listings.some((l) => l.producerId === producerId && l.productId === id);
  const [offerEdit, setOffer] = useState<string>();
  const offerId = offerEdit ?? mine?.productId ?? (asked.product && sells(asked.product.id) ? asked.product.id : '');
  const offered = boot.products.find((x) => x.id === offerId);
  const own = boot.listings.find((l) => l.producerId === producerId && l.productId === offerId);
  const sameAsAsked = offerId === r.productId;
  const left = r.qty - r.filledQty;
  const capacity = model === 'pooled' && r.pool && sameAsAsked ? r.pool.totalQty : left;
  // Untouched until edited, so the default follows what is offered
  const [priceEdit, setPrice] = useState<string>();
  const price = priceEdit ?? (mine && offerId === (mine.productId ?? r.productId) ? String(mine.price) : sameAsAsked && r.targetPrice !== undefined ? String(r.targetPrice) : own ? String(own.pricePerUnit) : '');
  // Untouched until edited, so the default follows the pool as other buyers join
  const [qtyEdit, setQty] = useState<string>();
  const qty = qtyEdit ?? String(mine?.qty ?? capacity);
  const [note, setNote] = useState(mine?.note ?? '');
  // The day offered: the day asked for unless the producer changes it (left alone, so pooled requests keep their own days)
  const [dayEdit, setDay] = useState<string>();
  const keptDay = mine?.deliveryDate && mine.deliveryDate > todayIso() ? mine.deliveryDate : undefined; // a day that has passed would be refused
  const sentDay = dayEdit === undefined ? keptDay : dayEdit || undefined; // cleared: the day asked for
  const offeredDay = sentDay ?? r.deliveryDate;
  const special = isSpecialDelivery(boot, offerId || r.productId, producerId, r.buyerId, offeredDay);
  const { fit, shelf } = bidFit(boot, offerId || r.productId, producerId, r.deliveryDate, offeredDay);
  const [editing, setEditing] = useState(false);

  return (
    <article data-testid={`demand-${r.id}`} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-mono font-semibold">{r.id}</span>
        <h3 className="text-lg font-semibold">{t('buyerAsks', { buyer: buyer.name, qty: r.qty, unit: asked.unit, product: asked.name })}</h3>
      </div>
      <div className="text-sm text-slate-600">
        {buyer.town}{km !== undefined && ` · ${t('km', { n: km })}`} · {t('neededBy')} {longDate(r.deliveryDate, lang)} ·{' '}
        {r.targetPrice !== undefined ? t('targetPrice', { price: r.targetPrice.toFixed(2) }) : t('noTarget')}
        {r.filledQty > 0 && ` · ${t('reqFilled', { filled: r.filledQty, qty: r.qty })}`}
      </div>
      {r.pool && <p data-testid="pool-note" className="mt-1 rounded bg-brand-light px-2 py-1 text-sm text-brand">{t('pooledWith', { qty: r.pool.totalQty, n: r.pool.buyers })}</p>}
      {r.note && <p className="mt-1 text-sm italic text-slate-600">“{r.note}”</p>}

      {r.expired && <p data-testid="demand-expired" className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900">{t('reqExpiredProducer')}</p>}

      {!r.expired && !(mine && !editing) && (
        <div className="mt-3 text-sm" data-testid="offer-field">
          <label className="font-medium">{t('offerLabel')}
            <select required value={offerId} onChange={(e) => { setOffer(e.target.value); setPrice(undefined); }} aria-label={t('offerLabel')} data-testid="offer-product"
              className={`${input} ml-2`}>
              <option value="">{t('offerChoose')}</option>
              {choices.map((x) => <option key={x.id} value={x.id}>{loc(x.name)}</option>)}
            </select>
          </label>
          <p className="mt-1 text-xs text-slate-600">{t(isOther(r.productId) ? 'offerElseHelp' : 'offerOtherHelp')}</p>
        </div>
      )}

      {r.expired && !mine ? null : model === 'first_accept' && !r.expired ? (
        r.targetPrice !== undefined && (
          <button disabled={!offerId || working} className="mt-3 rounded bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
            onClick={() => run(() => api(`/requests/${r.id}/take`, { method: 'POST', body: JSON.stringify({ productId: offerId }) }))}>{t('takeIt', { price: r.targetPrice.toFixed(2), qty: r.qty })}{isSpecialDelivery(boot, offerId || r.productId, producerId, r.buyerId, r.deliveryDate) ? ` (${t('specialDelivery').toLowerCase()})` : ''}</button>
        )
      ) : (
        <>
          <p className="mt-2 text-xs text-slate-500">{t('bidsSoFar', { n: r.bidCount })}</p>
          {mine && !editing ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded bg-gold-light p-2 text-sm" data-testid="my-bid">
              <b>{t('yourBid')}:</b> £{mine.price.toFixed(2)} × {mine.qty}{offered && mine.productId && mine.productId !== r.productId && <span data-testid="my-bid-offer"> · {t('offerInstead', { product: loc(offered.name) })}</span>}{mine.deliveryDate && <span data-testid="my-bid-day"> · {t('bidDelivers', { date: shortDate(mine.deliveryDate, lang) })}</span>}
              {!r.expired && <button disabled={working} className="underline" onClick={() => setEditing(true)}>{t('updateBid')}</button>}
              <button disabled={working} className="text-red-700 underline disabled:opacity-40" onClick={() => run(() => api(`/requests/${r.id}/bids/${mine.id}/withdraw`, { method: 'POST' }))}>{t('withdrawBid')}</button>
            </div>
          ) : (
            <form className="mt-3 flex flex-wrap items-end gap-3 text-sm" onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api(`/requests/${r.id}/bids`, { method: 'POST', body: JSON.stringify({ price: Number(price), qty: Number(qty), productId: offerId, note: note.trim() || undefined, deliveryDate: sentDay ?? '' }) }))) setEditing(false);
            }}>
              <label>{t('bidPriceLabel')}<input required type="number" min={0.01} step={0.01} value={price} onChange={(e) => setPrice(e.target.value)} className={`${input} ml-2 w-24`} /></label>
              <label>{t('bidQtyLabel')}<input required type="number" min={1} max={capacity} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className={`${input} ml-2 w-24`} /></label>
              <label>{t('bidDayLabel')}<input type="date" min={addDays(todayIso(), 1)} value={offeredDay} aria-label={t('bidDayLabel')} data-testid="bid-day"
                onChange={(e) => setDay(e.target.value)} className={`${input} ml-2`} /></label>
              <label className="min-w-48 flex-1">{t('bidNoteLabel')}<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className={`${input} ml-2 w-full`} /></label>
              <button disabled={!offerId || working} className="rounded bg-brand px-4 py-1.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-40">{mine ? t('updateBid') : t('placeBid')}</button>
              {editing && <button type="button" className="underline" onClick={() => setEditing(false)}>{t('cancel')}</button>}
              {(special || fit !== 'on_day') && (
                <p data-testid="bid-day-note" className="basis-full rounded bg-sky-50 p-2 text-xs text-sky-900">
                  {special && <span>{t('bidSpecialNote')} </span>}
                  {fit !== 'on_day' && <span>{t(`bidFit_${fit}`, { time: duration(t, shelf), needed: shortDate(r.deliveryDate, lang) })}</span>}
                </p>
              )}
              {model === 'pooled' && r.pool && sameAsAsked && <p className="basis-full text-xs text-slate-600">{t('poolBidNote', { n: r.pool.requests })}</p>}
            </form>
          )}
        </>
      )}
    </article>
  );
}
