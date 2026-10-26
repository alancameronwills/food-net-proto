import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Bid, RequestView } from '../../shared/types';
import { api, type Bootstrap } from '../api';
import { loc } from '../i18n';
import { longDate } from './Browse';

const input = 'rounded border border-slate-300 bg-white px-2 py-1';

/** What local buyers are asking for. Producers bid (sealed), or accept the buyer's price under first-to-accept. */
export function DemandBoard({ producerId, boot, requests, reload }: { producerId: string; boot: Bootstrap; requests: RequestView[]; reload: () => void }) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState('');
  const model = boot.config.speculative;
  const open = requests.filter((r) => r.status === 'open');
  const decided = requests.filter((r) => r.status !== 'open');

  const run = async (f: () => Promise<unknown>) => {
    try { setError(''); await f(); reload(); return true; } catch (e) { setError((e as Error).message); reload(); return false; }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-600">{t('demandIntro')}</p>
      {error && <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}
      {open.length === 0 && <p className="text-slate-600">{t('demandNone')}</p>}
      {open.map((r) => <RequestCard key={r.id} r={r} boot={boot} producerId={producerId} model={model} run={run} lang={i18n.language} />)}

      {decided.length > 0 && (
        <section className="space-y-2 pt-2">
          <h3 className="text-lg font-semibold text-brand-dark">{t('decidedHeading')} ({decided.length})</h3>
          {decided.map((r) => {
            const p = boot.products.find((x) => x.id === r.productId)!;
            const mine = r.bids.find((b) => b.status === 'accepted') ?? r.bids[r.bids.length - 1];
            return (
              <div key={r.id} data-testid={`decided-${r.id}`} className="flex flex-wrap items-center gap-x-4 rounded border border-slate-200 bg-white p-3 text-sm">
                <span className="font-mono font-semibold">{r.id}</span>
                <span>{loc(p.name)} · {r.qty} {t(`units.${p.unit}`)}</span>
                <span className="text-slate-500">{longDate(r.deliveryDate, i18n.language)}</span>
                <span className={`ml-auto font-semibold ${mine?.status === 'accepted' ? 'text-emerald-800' : 'text-slate-500'}`}>
                  {mine?.status === 'accepted' ? t('outcomeWon', { id: mine.orderId }) : r.status === 'closed' ? t('outcomeClosed') : t('outcomeLost')}
                </span>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

function RequestCard({ r, boot, producerId, model, run, lang }: {
  r: RequestView; boot: Bootstrap; producerId: string; model: string; run: (f: () => Promise<unknown>) => Promise<boolean>; lang: string;
}) {
  const { t } = useTranslation();
  const p = boot.products.find((x) => x.id === r.productId)!;
  const buyer = boot.orgs.find((o) => o.id === r.buyerId)!;
  const km = boot.distances[r.buyerId]?.[producerId];
  const mine: Bid | undefined = r.bids.find((b) => b.producerId === producerId && b.status === 'open');
  const own = boot.listings.find((l) => l.producerId === producerId && l.productId === r.productId);
  const left = r.qty - r.filledQty;
  const capacity = model === 'pooled' && r.pool ? r.pool.totalQty : left;
  const [price, setPrice] = useState(mine ? String(mine.price) : r.targetPrice !== undefined ? String(r.targetPrice) : own ? String(own.pricePerUnit) : '');
  // Untouched until edited, so the default follows the pool as other buyers join
  const [qtyEdit, setQty] = useState<string>();
  const qty = qtyEdit ?? String(mine?.qty ?? capacity);
  const [note, setNote] = useState(mine?.note ?? '');
  const [editing, setEditing] = useState(false);

  return (
    <article data-testid={`demand-${r.id}`} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-mono font-semibold">{r.id}</span>
        <h3 className="text-lg font-semibold">{t('buyerAsks', { buyer: buyer.name, qty: r.qty, unit: t(`units.${p.unit}`), product: loc(p.name) })}</h3>
      </div>
      <div className="text-sm text-slate-600">
        {buyer.town}{km !== undefined && ` · ${t('km', { n: km })}`} · {t('neededBy')} {longDate(r.deliveryDate, lang)} ·{' '}
        {r.targetPrice !== undefined ? t('targetPrice', { price: r.targetPrice.toFixed(2) }) : t('noTarget')}
        {r.filledQty > 0 && ` · ${t('reqFilled', { filled: r.filledQty, qty: r.qty })}`}
      </div>
      {r.pool && <p data-testid="pool-note" className="mt-1 rounded bg-brand-light px-2 py-1 text-sm text-brand">{t('pooledWith', { qty: r.pool.totalQty, n: r.pool.buyers })}</p>}
      {r.note && <p className="mt-1 text-sm italic text-slate-600">“{r.note}”</p>}

      {model === 'first_accept' ? (
        r.targetPrice !== undefined && (
          <button className="mt-3 rounded bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"
            onClick={() => run(() => api(`/requests/${r.id}/take`, { method: 'POST' }))}>{t('takeIt', { price: r.targetPrice.toFixed(2), qty: r.qty })}</button>
        )
      ) : (
        <>
          <p className="mt-2 text-xs text-slate-500">{t('bidsSoFar', { n: r.bidCount })}</p>
          {mine && !editing ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded bg-gold-light p-2 text-sm" data-testid="my-bid">
              <b>{t('yourBid')}:</b> £{mine.price.toFixed(2)} × {mine.qty}
              <button className="underline" onClick={() => setEditing(true)}>{t('updateBid')}</button>
              <button className="text-red-700 underline" onClick={() => run(() => api(`/requests/${r.id}/bids/${mine.id}/withdraw`, { method: 'POST' }))}>{t('withdrawBid')}</button>
            </div>
          ) : (
            <form className="mt-3 flex flex-wrap items-end gap-3 text-sm" onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api(`/requests/${r.id}/bids`, { method: 'POST', body: JSON.stringify({ price: Number(price), qty: Number(qty), note: note.trim() || undefined }) }))) setEditing(false);
            }}>
              <label>{t('bidPriceLabel')}<input required type="number" min={0.01} step={0.01} value={price} onChange={(e) => setPrice(e.target.value)} className={`${input} ml-2 w-24`} /></label>
              <label>{t('bidQtyLabel')}<input required type="number" min={1} max={capacity} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className={`${input} ml-2 w-24`} /></label>
              <label className="min-w-48 flex-1">{t('bidNoteLabel')}<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className={`${input} ml-2 w-full`} /></label>
              <button className="rounded bg-brand px-4 py-1.5 font-semibold text-white hover:bg-brand-dark">{mine ? t('updateBid') : t('placeBid')}</button>
              {editing && <button type="button" className="underline" onClick={() => setEditing(false)}>{t('cancel')}</button>}
              {model === 'pooled' && r.pool && <p className="basis-full text-xs text-slate-600">{t('poolBidNote', { n: r.pool.requests })}</p>}
            </form>
          )}
        </>
      )}
    </article>
  );
}
