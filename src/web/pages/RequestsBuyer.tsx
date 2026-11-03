import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { offersFor } from '../../shared/browse';
import { addDays, todayIso } from '../../shared/dates';
import { availableForUse, deliverableDates, shelfLifeFor } from '../../shared/availability';
import { bidFit, isSpecialDelivery, requestDateNote } from '../delivery-info';
import { duration, shortDate } from '../format';
import { nextWeekday } from '../../shared/orders';
import { localStatus } from '../../shared/models';
import type { RequestView, SupplyWindow } from '../../shared/types';
import { api, type Bootstrap } from '../api';
import { loc } from '../i18n';
import { longDate } from './Browse';
import { requestedAs, isOther } from '../requested';
import { OTHER_PRODUCT } from '../../shared/types';
import { TrustChip } from './TrustChip';

const input = 'rounded border border-slate-300 bg-white px-2 py-1';
const STATUS: Record<string, string> = { open: 'bg-gold-light text-amber-900', filled: 'bg-emerald-100 text-emerald-800', closed: 'bg-slate-200 text-slate-700' };
const BID_STATUS: Record<string, string> = { open: 'text-amber-800', accepted: 'font-semibold text-emerald-800', rejected: 'text-slate-500', withdrawn: 'text-slate-500' };

/** Who can see a request for this product: producers within the local range, and how many of those already sell it. */
function reachOf(boot: Bootstrap, buyerId: string, productId: string) {
  const product = boot.products.find((p) => p.id === productId);
  const category = product && boot.categories.find((c) => c.id === product.category);
  if (!product || !category) return { seen: 0, sellers: 0, sellersAnywhere: 0 };
  const near = (producerId: string) => {
    const km = boot.distances[buyerId]?.[producerId];
    return km !== undefined && localStatus(boot.config, category.maxDriveKm, km) !== 'hidden';
  };
  const producers = boot.orgs.filter((o) => o.role === 'producer');
  const sells = (producerId: string) => boot.listings.some((l) => l.producerId === producerId && l.productId === productId);
  return {
    seen: producers.filter((o) => near(o.id)).length,
    sellers: producers.filter((o) => near(o.id) && sells(o.id)).length,
    sellersAnywhere: producers.filter((o) => sells(o.id)).length,
  };
}

function ReachNote({ boot, buyerId, productId, testId }: { boot: Bootstrap; buyerId: string; productId: string; testId: string }) {
  const { t } = useTranslation();
  const r = reachOf(boot, buyerId, productId);
  const none = r.seen === 0;
  const key = none ? 'reachNone' : r.sellers === 0 ? 'reachNoSellers' : 'reachSome';
  const warn = none || r.sellers === 0;
  return (
    <p data-testid={testId} data-reach={key} className={`rounded p-2 text-sm ${warn ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700'}`}>
      {t(key, { seen: r.seen, sellers: r.sellers, anywhere: r.sellersAnywhere })}
    </p>
  );
}

/** A buyer asks for something that is not listed yet, then chooses among the bids. */
export function RequestsBuyer({ buyerId, boot, windows, requests, reload, onBrowse }: {
  buyerId: string; boot: Bootstrap; windows: SupplyWindow[]; requests: RequestView[]; reload: () => unknown;
  onBrowse: (date: string, productName: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [date, setDate] = useState(nextWeekday(addDays(todayIso(), 21), [4]));
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const model = boot.config.speculative;
  const product = boot.products.find((p) => p.id === productId);
  const else_ = isOther(productId);
  const dateNote = product ? requestDateNote(boot, product.id, date) : undefined;

  // One action at a time (a double click must not send twice), and look again after a failure: what the buyer saw may be stale
  const acting = useRef(new Set<string>());
  const [working, setWorking] = useState<string[]>([]);
  const run = async (key: string, f: () => Promise<unknown>) => {
    if (acting.current.has(key)) return false; // already on its way: the buttons are off, so this is only a double click
    acting.current.add(key); setWorking([...acting.current]);
    try { setError(''); await f(); await reload(); return true; } catch (e) { setError((e as Error).message); await reload(); return false; }
    finally { acting.current.delete(key); setWorking([...acting.current]); }
  };

  // Is what they want already on sale? Then Browse is quicker than waiting for bids.
  const already = useMemo(() => {
    if (!product) return 0;
    const byWindow = new Map(windows.map((w) => [`${w.listingId}#${w.start}`, w]));
    const wanted = Math.max(1, Number(qty) || 1);
    return offersFor(buyerId, boot).filter((o) => {
      if (o.product.id !== product.id || o.status === 'hidden') return false;
      const days = deliverableDates({ config: boot.config, category: o.category, listing: o.listing, rule: o.rule, driveKm: o.driveKm, windows: byWindow, today: todayIso() });
      const use = availableForUse(days, shelfLifeFor(o.category, o.listing), date);
      return use.ok && use.best.orderable >= wanted;
    }).length;
  }, [product, buyerId, boot, windows, date, qty]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await run('new', () => api('/requests', { method: 'POST', body: JSON.stringify({
      productId, qty: Number(qty), deliveryDate: date, targetPrice: target ? Number(target) : undefined, note: note.trim() || undefined }) }));
    setBusy(false);
    if (ok) { setQty(''); setTarget(''); setNote(''); }
  };

  const byCategory = boot.categories.map((c) => ({ c, items: boot.products.filter((p) => p.category === c.id) }));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid="request-form">
        <h2 className="text-lg font-bold text-brand">{t('reqTitle')}</h2>
        <p className="text-sm text-slate-600">{t(model === 'first_accept' ? 'reqIntroFirst' : 'reqIntro')} {model === 'pooled' && t('reqIntroPooled')}</p>
        <label className="block text-sm font-medium">{t('reqProduct')}
          <select required value={productId} onChange={(e) => setProductId(e.target.value)} className={`${input} mt-1 w-full`}>
            <option value="">{t('reqChoose')}</option>
            {byCategory.map(({ c, items }) => (
              <optgroup key={c.id} label={loc(c.name)}>{items.map((p) => <option key={p.id} value={p.id}>{loc(p.name)}</option>)}</optgroup>
            ))}
            <option value={OTHER_PRODUCT}>{t('reqSomethingElse')}</option>
          </select>
        </label>
        {else_ && <p data-testid="else-help" className="rounded bg-sky-50 p-2 text-sm text-sky-900">{t('reqElseHelp')}</p>}
        <div className="flex gap-3">
          <label className="block flex-1 text-sm font-medium">{t('reqQty')}{product ? ` (${t(`units.${product.unit}`)})` : else_ ? ` (${t('unitsOther')})` : ''}
            <input required type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className={`${input} mt-1 w-full`} />
          </label>
          <label className="block flex-1 text-sm font-medium">{t('reqDate')}
            <input required type="date" min={addDays(todayIso(), 1)} value={date} onChange={(e) => setDate(e.target.value)} className={`${input} mt-1 w-full`} />
          </label>
        </div>
        <label className="block text-sm font-medium">{t('reqTarget')} {model !== 'first_accept' && <span className="font-normal text-slate-500">({t('reqTargetOptional')})</span>}
          <input required={model === 'first_accept'} type="number" min={0.01} step={0.01} value={target} onChange={(e) => setTarget(e.target.value)} className={`${input} mt-1 w-full`} />
        </label>
        <label className="block text-sm font-medium">{t('reqNote')}
          <textarea required={else_} value={note} onChange={(e) => setNote(e.target.value)} rows={else_ ? 3 : 2} maxLength={300} className={`${input} mt-1 w-full`} />
        </label>
        {dateNote && (
          <p data-testid="date-note" className="rounded bg-sky-50 p-2 text-sm text-sky-900">
            {t(dateNote.kind === 'short' ? 'dateNoteShort' : 'dateNoteUnusual', { product: product ? loc(product.name) : '', date: shortDate(date, i18n.language), n: dateNote.days })}
          </p>
        )}
        {product && <ReachNote boot={boot} buyerId={buyerId} productId={product.id} testId="reach-form" />}
        {already > 0 && (
          <p data-testid="already-available" className="rounded bg-emerald-50 p-2 text-sm text-emerald-900">
            {t('reqAlready', { n: already })}{' '}
            <button type="button" className="underline" onClick={() => onBrowse(date, product ? product.name.en : '')}>{t('reqSeeBrowse')}</button>
          </p>
        )}
        {error && <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}
        <button disabled={busy || working.includes('new')} className="w-full rounded bg-brand py-2 font-semibold text-white hover:bg-brand-dark disabled:opacity-50">{t('reqSend')}</button>
      </form>

      <section>
        <h2 className="mb-3 text-lg font-bold text-brand">{t('myRequests')}</h2>
        {requests.length === 0 && <p className="text-slate-600">{t('noRequests')}</p>}
        <div className="space-y-4">
          {requests.map((r) => {
            const asked = requestedAs(boot, r.productId, t);
            const left = r.qty - r.filledQty;
            return (
              <article key={r.id} data-testid={`request-${r.id}`} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono font-semibold">{r.id}</span>
                  <span data-testid="request-status" className={`rounded px-2 py-0.5 text-sm font-semibold ${STATUS[r.status]}`}>{t(`reqStatus_${r.status}`)}</span>
                  <b>{r.qty} {asked.unit} {asked.name}</b>
                  <span className="text-sm text-slate-600">{longDate(r.deliveryDate, i18n.language)}</span>
                  {r.targetPrice !== undefined && <span className="text-sm text-slate-600">£{r.targetPrice.toFixed(2)} / {asked.product ? asked.unit : t('unitsOther')}</span>}
                  {r.filledQty > 0 && <span className="text-sm text-emerald-800">{t('reqFilled', { filled: r.filledQty, qty: r.qty })}</span>}
                </div>
                {requestDateNote(boot, r.productId, r.deliveryDate) && r.status === 'open' && (
                  <p data-testid="request-date-note" className="mt-1 text-xs text-sky-900">{t('requestOffersDifferent')}</p>
                )}
                {r.pool && <p data-testid="pool-note" className="mt-1 rounded bg-brand-light px-2 py-1 text-sm text-brand">{t('pooledWith', { qty: r.pool.totalQty, n: r.pool.buyers })}</p>}
                {r.note && <p className="mt-1 text-sm italic text-slate-600">“{r.note}”</p>}

                {r.expired && <p data-testid="request-expired" className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900">{t('reqExpired')}</p>}
                {r.status === 'open' && !isOther(r.productId) && <div className="mt-2"><ReachNote boot={boot} buyerId={buyerId} productId={r.productId} testId="reach-request" /></div>}
                {r.bids.length === 0 && r.status === 'open' && !r.expired && (
                  <p className="mt-2 text-sm text-slate-600">{model === 'first_accept' && r.targetPrice !== undefined ? t('waitingTake', { price: r.targetPrice.toFixed(2) }) : t('waitingBids')}</p>
                )}
                {r.bids.length > 0 && (
                  <table className="mt-2 w-full text-left text-sm">
                    <thead className="text-xs text-slate-500">
                      <tr><th className="py-1">{t('bidFrom')}</th><th>{t('bidPrice')}</th><th>{t('bidQty')}</th><th>{t('bidNote')}</th><th /></tr>
                    </thead>
                    <tbody>
                      {[...r.bids].sort((a, b) => a.price - b.price).map((b) => {
                        const org = boot.orgs.find((o) => o.id === b.producerId) ?? { name: b.producerId, town: '' };
                        const km = boot.distances[buyerId]?.[b.producerId];
                        return (
                          <tr key={b.id} data-testid={`bid-${r.id}-${b.producerId}`} className="border-t border-slate-100 align-top">
                            <td className="py-1">{org.name}<div className="text-xs text-slate-500">{org.town}{km !== undefined && ` · ${t('km', { n: km })}`}</div><TrustChip producerId={b.producerId} boot={boot} />
                              {(() => {
                                const day = b.deliveryDate ?? r.deliveryDate;
                                const offeredId = b.productId ?? r.productId;
                                const { fit, shelf } = bidFit(boot, offeredId, b.producerId, r.deliveryDate, day);
                                const special = isSpecialDelivery(boot, offeredId, b.producerId, r.buyerId, day);
                                const offered = boot.products.find((x) => x.id === offeredId);
                                return (
                                  <div className="mt-1 text-xs" data-testid={`bid-delivery-${r.id}-${b.producerId}`}>
                                    {offered && <div data-testid={`bid-offers-${r.id}-${b.producerId}`} className={`mb-0.5 font-semibold ${offeredId === r.productId ? 'text-slate-700' : 'text-brand'}`}>{t('bidOffers', { product: loc(offered.name) })}</div>}
                                    <span className="font-medium">{t('bidDelivers', { date: shortDate(day, i18n.language) })}</span>
                                    {fit !== 'on_day' && <span data-testid="bid-fit" data-fit={fit} className={`ml-1 rounded px-1.5 py-0.5 ${fit === 'early' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>{t(`fit_${fit}`, { time: duration(t, shelf) })}</span>}
                                    {special && <span data-testid="bid-special" className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-sky-900">{t('specialDelivery')}</span>}
                                  </div>
                                );
                              })()}</td>
                            <td className="py-1">£{b.price.toFixed(2)}</td>
                            <td className="py-1">{b.qty}</td>
                            <td className="py-1 text-slate-600">{b.note}</td>
                            <td className="py-1 text-right">
                              {b.status === 'open' && r.status === 'open' ? (
                                <button disabled={b.qty > left || working.includes(r.id) || !!r.expired} title={r.expired ? t('outcomeExpired') : b.qty > left ? t('onlyN', { n: left }) : undefined}
                                  className="rounded bg-emerald-700 px-3 py-1 font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
                                  onClick={() => run(r.id, () => api(`/requests/${r.id}/accept`, { method: 'POST', body: JSON.stringify({ bidId: b.id }) }))}>{t('acceptBid')}</button>
                              ) : (
                                <span className={BID_STATUS[b.status]}>{t(`bidStatus_${b.status}`)}{b.orderId && ` · ${t('orderMade', { id: b.orderId })}`}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {r.status === 'open' && (
                  <button disabled={working.includes(r.id)} className="mt-3 text-sm text-red-700 underline disabled:opacity-40"
                    onClick={() => { if (confirm(t('confirmWithdrawRequest'))) void run(r.id, () => api(`/requests/${r.id}/close`, { method: 'POST' })); }}>{t('withdrawRequest')}</button>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
