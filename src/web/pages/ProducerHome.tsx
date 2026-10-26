import { useTranslation } from 'react-i18next';
import type { Confidence, Persona } from '../../shared/types';
import { useWindows, type Bootstrap } from '../api';
import { loc } from '../i18n';

const BADGE: Record<Confidence, string> = {
  in_stock: 'bg-emerald-100 text-emerald-800',
  forecast: 'bg-gold-light text-amber-800',
  provisional: 'bg-slate-200 text-slate-700',
};
const LABEL: Record<Confidence, string> = { in_stock: 'inStock', forecast: 'forecast', provisional: 'provisional' };

export function ProducerHome({ me, boot }: { me: Persona; boot: Bootstrap }) {
  const { t } = useTranslation();
  const { data: windows } = useWindows();
  const products = new Map(boot.products.map((p) => [p.id, p]));
  const mine = boot.listings.filter((l) => l.producerId === me.id);
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-brand">{t('yourListings')}</h1>
      <div className="space-y-4">
        {mine.map((l) => {
          const p = products.get(l.productId)!;
          const ws = (windows ?? []).filter((w) => w.listingId === l.id).sort((a, b) => a.start.localeCompare(b.start));
          return (
            <section key={l.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-lg font-semibold">{loc(p.name)}</h2>
                <span className="text-slate-500">£{l.pricePerUnit.toFixed(2)} {t('perUnit', { unit: t(`units.${p.unit}`) })}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {ws.map((w) => (
                  <div key={w.start} className="rounded border border-slate-200 p-2 text-sm">
                    <div className="text-xs text-slate-500">{t('week')} {w.start.slice(5)}</div>
                    <div className="text-lg font-semibold">{w.qtyTotal - w.qtyReserved}<span className="text-sm font-normal text-slate-500"> / {w.qtyTotal}</span></div>
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${BADGE[w.confidence]}`}>{t(LABEL[w.confidence])}</span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
