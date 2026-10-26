import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { offersFor } from '../../shared/browse';
import { addDays, todayIso } from '../../shared/dates';
import { availabilityFor, nextWeekday, windowKey } from '../../shared/orders';
import type { RequestView, SupplyWindow } from '../../shared/types';
import { api, type Bootstrap } from '../api';
import { loc } from '../i18n';
import { longDate } from './Browse';
import { TrustChip } from './TrustChip';

const input = 'rounded border border-slate-300 bg-white px-2 py-1';
const STATUS: Record<string, string> = { open: 'bg-gold-light text-amber-900', filled: 'bg-emerald-100 text-emerald-800', closed: 'bg-slate-200 text-slate-700' };
const BID_STATUS: Record<string, string> = { open: 'text-amber-800', accepted: 'font-semibold text-emerald-800', rejected: 'text-slate-500', withdrawn: 'text-slate-500' };

/** A buyer asks for something that is not listed yet, then chooses among the bids. */
export function RequestsBuyer({ buyerId, boot, windows, requests, reload, onBrowse }: {
  buyerId: string; boot: Bootstrap; windows: SupplyWindow[]; requests: RequestView[]; reload: () => void;
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

  const run = async (f: () => Promise<unknown>) => {
    try { setError(''); await f(); reload(); return true; } catch (e) { setError((e as Error).message); return false; }
  };

  // Is what they want already on sale? Then Browse is quicker than waiting for bids.
  const already = useMemo(() => {
    if (!product) return 0;
    const byWindow = new Map(windows.map((w) => [`${w.listingId}#${w.start}`, w]));
    return offersFor(buyerId, boot).filter((o) => o.product.id === product.id && o.status !== 'hidden'
      && availabilityFor({ config: boot.config, category: o.category, listing: o.listing, window: byWindow.get(windowKey(o.listing.id, date)), date, today: todayIso(), driveKm: o.driveKm, rule: o.rule }).orderable >= Math.max(1, Number(qty) || 1)).length;
  }, [product, buyerId, boot, windows, date, qty]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await run(() => api('/requests', { method: 'POST', body: JSON.stringify({
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
          </select>
        </label>
        <div className="flex gap-3">
          <label className="block flex-1 text-sm font-medium">{t('reqQty')}{product && ` (${t(`units.${product.unit}`)})`}
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
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} className={`${input} mt-1 w-full`} />
        </label>
        {already > 0 && (
          <p data-testid="already-available" className="rounded bg-emerald-50 p-2 text-sm text-emerald-900">
            {t('reqAlready', { n: already })}{' '}
            <button type="button" className="underline" onClick={() => onBrowse(date, product ? product.name.en : '')}>{t('reqSeeBrowse')}</button>
          </p>
        )}
        {error && <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}
        <button disabled={busy} className="w-full rounded bg-brand py-2 font-semibold text-white hover:bg-brand-dark disabled:opacity-50">{t('reqSend')}</button>
      </form>

      <section>
        <h2 className="mb-3 text-lg font-bold text-brand">{t('myRequests')}</h2>
        {requests.length === 0 && <p className="text-slate-600">{t('noRequests')}</p>}
        <div className="space-y-4">
          {requests.map((r) => {
            const p = boot.products.find((x) => x.id === r.productId)!;
            const left = r.qty - r.filledQty;
            return (
              <article key={r.id} data-testid={`request-${r.id}`} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono font-semibold">{r.id}</span>
                  <span data-testid="request-status" className={`rounded px-2 py-0.5 text-sm font-semibold ${STATUS[r.status]}`}>{t(`reqStatus_${r.status}`)}</span>
                  <b>{r.qty} {t(`units.${p.unit}`)} {loc(p.name)}</b>
                  <span className="text-sm text-slate-600">{longDate(r.deliveryDate, i18n.language)}</span>
                  {r.targetPrice !== undefined && <span className="text-sm text-slate-600">£{r.targetPrice.toFixed(2)} / {t(`units.${p.unit}`)}</span>}
                  {r.filledQty > 0 && <span className="text-sm text-emerald-800">{t('reqFilled', { filled: r.filledQty, qty: r.qty })}</span>}
                </div>
                {r.pool && <p data-testid="pool-note" className="mt-1 rounded bg-brand-light px-2 py-1 text-sm text-brand">{t('pooledWith', { qty: r.pool.totalQty, n: r.pool.buyers })}</p>}
                {r.note && <p className="mt-1 text-sm italic text-slate-600">“{r.note}”</p>}

                {r.bids.length === 0 && r.status === 'open' && (
                  <p className="mt-2 text-sm text-slate-600">{model === 'first_accept' && r.targetPrice !== undefined ? t('waitingTake', { price: r.targetPrice.toFixed(2) }) : t('waitingBids')}</p>
                )}
                {r.bids.length > 0 && (
                  <table className="mt-2 w-full text-left text-sm">
                    <thead className="text-xs text-slate-500">
                      <tr><th className="py-1">{t('bidFrom')}</th><th>{t('bidPrice')}</th><th>{t('bidQty')}</th><th>{t('bidNote')}</th><th /></tr>
                    </thead>
                    <tbody>
                      {[...r.bids].sort((a, b) => a.price - b.price).map((b) => {
                        const org = boot.orgs.find((o) => o.id === b.producerId)!;
                        const km = boot.distances[buyerId]?.[b.producerId];
                        return (
                          <tr key={b.id} data-testid={`bid-${r.id}-${b.producerId}`} className="border-t border-slate-100 align-top">
                            <td className="py-1">{org.name}<div className="text-xs text-slate-500">{org.town}{km !== undefined && ` · ${t('km', { n: km })}`}</div><TrustChip producerId={b.producerId} boot={boot} /></td>
                            <td className="py-1">£{b.price.toFixed(2)}</td>
                            <td className="py-1">{b.qty}</td>
                            <td className="py-1 text-slate-600">{b.note}</td>
                            <td className="py-1 text-right">
                              {b.status === 'open' && r.status === 'open' ? (
                                <button disabled={b.qty > left} title={b.qty > left ? t('onlyN', { n: left }) : undefined}
                                  className="rounded bg-emerald-700 px-3 py-1 font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
                                  onClick={() => run(() => api(`/requests/${r.id}/accept`, { method: 'POST', body: JSON.stringify({ bidId: b.id }) }))}>{t('acceptBid')}</button>
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
                  <button className="mt-3 text-sm text-red-700 underline"
                    onClick={() => { if (confirm(t('confirmWithdrawRequest'))) void run(() => api(`/requests/${r.id}/close`, { method: 'POST' })); }}>{t('withdrawRequest')}</button>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
