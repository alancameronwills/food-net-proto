import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { capabilities } from '../../shared/models';
import type { Listing, Product } from '../../shared/types';
import { api, type Bootstrap } from '../api';
import { loc } from '../i18n';

type Tier = { minQty: string; price: string };
const toTiers = (l?: Listing): Tier[] => (l?.tiers ?? []).map((x) => ({ minQty: String(x.minQty), price: String(x.price) }));
const input = 'rounded border border-slate-300 bg-white px-2 py-1';

/** Catalogue of what this producer sells: add products, set prices, minimum orders and volume prices. */
export function ListingsEditor({ producerId, boot, reload }: { producerId: string; boot: Bootstrap; reload: () => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const mine = boot.listings.filter((l) => l.producerId === producerId);
  const products = new Map(boot.products.map((p) => [p.id, p]));
  const available = boot.products.filter((p) => !mine.some((l) => l.productId === p.id));
  const tiersOn = capabilities(boot.config).volumeTiers;

  const run = async (f: () => Promise<unknown>) => {
    try { setError(''); await f(); reload(); return true; } catch (e) { setError((e as Error).message); return false; }
  };

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}
      {mine.length === 0 && <p className="text-slate-600">{t('noListings')}</p>}

      {mine.map((l) => {
        const p = products.get(l.productId)!;
        return editing === l.id ? (
          <ListingForm key={l.id} product={p} listing={l} tiersOn={tiersOn} onCancel={() => setEditing(undefined)}
            onSubmit={async (b) => { if (await run(() => api(`/listings/${encodeURIComponent(l.id)}`, { method: 'PUT', body: JSON.stringify(b) }))) setEditing(undefined); }} />
        ) : (
          <div key={l.id} data-testid={`listing-${l.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="min-w-48 flex-1">
              <div className="font-semibold">{loc(p.name)}</div>
              <div className="text-xs text-slate-500">{loc(boot.categories.find((c) => c.id === p.category)!.name)}</div>
            </div>
            <div>£{l.pricePerUnit.toFixed(2)} {t('perUnit', { unit: t(`units.${p.unit}`) })}</div>
            <div className="text-sm text-slate-600">{t('minOrderLabel')}: {l.minOrder}</div>
            {l.tiers?.length ? <div className="text-sm text-slate-600">{l.tiers.map((x) => `${x.minQty}+ £${x.price.toFixed(2)}`).join(' · ')}</div> : null}
            <button className="rounded border border-brand px-3 py-1 text-sm font-medium text-brand hover:bg-brand-light" onClick={() => setEditing(l.id)}>{t('edit')}</button>
            <button className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
              onClick={() => { if (confirm(t('confirmRemoveListing'))) void run(() => api(`/listings/${encodeURIComponent(l.id)}`, { method: 'DELETE' })); }}>{t('remove')}</button>
          </div>
        );
      })}

      {adding ? (
        <ListingForm products={available} tiersOn={tiersOn} onCancel={() => setAdding(false)}
          onSubmit={async (b) => { if (await run(() => api('/listings', { method: 'POST', body: JSON.stringify(b) }))) setAdding(false); }} />
      ) : (
        <button disabled={available.length === 0} className="rounded bg-gold px-4 py-2 font-semibold text-brand-dark disabled:opacity-50" onClick={() => setAdding(true)}>
          {t('addListing')}
        </button>
      )}
    </div>
  );
}

function ListingForm({ product, products, listing, tiersOn, onSubmit, onCancel }: {
  product?: Product; products?: Product[]; listing?: Listing; tiersOn: boolean;
  onSubmit: (body: Record<string, unknown>) => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [productId, setProductId] = useState(product?.id ?? '');
  const [price, setPrice] = useState(listing ? String(listing.pricePerUnit) : '');
  const [minOrder, setMinOrder] = useState(listing ? String(listing.minOrder) : '1');
  const [tiers, setTiers] = useState<Tier[]>(toTiers(listing));
  const chosen = product ?? products?.find((p) => p.id === productId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { pricePerUnit: Number(price), minOrder: Number(minOrder) };
    if (!listing) body.productId = productId;
    if (tiersOn || listing?.tiers) body.tiers = tiers.filter((x) => x.minQty && x.price).map((x) => ({ minQty: Number(x.minQty), price: Number(x.price) }));
    onSubmit(body);
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border-2 border-brand bg-brand-light p-4">
      {product ? <h3 className="text-lg font-semibold">{loc(product.name)}</h3> : (
        <select required value={productId} onChange={(e) => setProductId(e.target.value)} className={`${input} w-full sm:w-80`} aria-label={t('product')}>
          <option value="">{t('chooseProduct')}</option>
          {products?.map((p) => <option key={p.id} value={p.id}>{loc(p.name)}</option>)}
        </select>
      )}
      <div className="flex flex-wrap gap-4">
        <label className="text-sm">{t('pricePerUnitLabel')}
          <input required type="number" min={0.01} step={0.01} value={price} onChange={(e) => setPrice(e.target.value)} className={`${input} ml-2 w-28`} />
          {chosen && <span className="ml-1 text-slate-500">{t('perUnit', { unit: t(`units.${chosen.unit}`) })}</span>}
        </label>
        <label className="text-sm">{t('minOrderLabel')}
          <input required type="number" min={0.01} step="any" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} className={`${input} ml-2 w-24`} />
        </label>
      </div>

      {(tiersOn || tiers.length > 0) && (
        <fieldset className="text-sm">
          <legend className="font-medium">{t('volumeTiers')}</legend>
          {!tiersOn && <p className="text-xs text-slate-500">{t('tiersOnlyNote')}</p>}
          {tiers.map((tier, i) => (
            <div key={i} className="mt-1 flex flex-wrap items-center gap-2">
              <label>{t('tierFrom')}<input type="number" min={1} value={tier.minQty} className={`${input} ml-2 w-24`}
                onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, minQty: e.target.value } : x)))} /></label>
              <label>{t('tierPrice')}<input type="number" min={0.01} step={0.01} value={tier.price} className={`${input} ml-2 w-24`}
                onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} /></label>
              <button type="button" aria-label={t('remove')} className="px-2 text-red-700" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          {tiers.length < 3 && <button type="button" className="mt-2 text-brand underline" onClick={() => setTiers([...tiers, { minQty: '', price: '' }])}>{t('addTier')}</button>}
        </fieldset>
      )}

      <div className="flex gap-3">
        <button className="rounded bg-brand px-4 py-1.5 font-semibold text-white">{t('save')}</button>
        <button type="button" className="px-2 text-slate-600 underline" onClick={onCancel}>{t('cancel')}</button>
      </div>
    </form>
  );
}
