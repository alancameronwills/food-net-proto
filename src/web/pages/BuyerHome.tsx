import { useTranslation } from 'react-i18next';
import { offersFor } from '../../shared/browse';
import { capabilities } from '../../shared/models';
import type { Persona } from '../../shared/types';
import type { Bootstrap } from '../api';
import { loc } from '../i18n';

export function BuyerHome({ me, boot }: { me: Persona; boot: Bootstrap }) {
  const { t } = useTranslation();
  const caps = capabilities(boot.config);
  const offers = offersFor(me.id, boot);
  const shown = offers.filter((o) => o.status !== 'hidden');
  const hidden = offers.length - shown.length;
  return (
    <div>
      <h1 className="text-2xl font-bold text-brand">{t('localSuppliers')}</h1>
      <p className="mb-4 text-slate-600">{t('localSub')}</p>
      {caps.showReliability && <p className="mb-2 text-sm text-slate-500">★ {t('comingSoon')}</p>}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-brand-light text-sm text-brand-dark">
            <tr>
              <th className="p-3">{t('product')}</th><th className="p-3">{t('producer')}</th>
              <th className="p-3">{t('distance')}</th><th className="p-3">{t('range')}</th>
              <th className="p-3">{t('price')}</th><th className="p-3">{t('status')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.listing.id} className={`border-t border-slate-100 ${o.status === 'warn' ? 'bg-slate-100 text-slate-500' : ''}`}>
                <td className="p-3 font-medium">{loc(o.product.name)}<div className="text-xs text-slate-500">{loc(o.category.name)}</div></td>
                <td className="p-3">{o.producer.name}<div className="text-xs text-slate-500">{o.producer.town}</div></td>
                <td className="p-3">{t('km', { n: o.driveKm })}</td>
                <td className="p-3">{t('km', { n: o.limitKm })}</td>
                <td className="p-3">£{o.listing.pricePerUnit.toFixed(2)} {t('perUnit', { unit: t(`units.${o.product.unit}`) })}</td>
                <td className="p-3">
                  <span className={`rounded px-2 py-0.5 text-sm font-semibold ${o.status === 'ok' ? 'bg-emerald-100 text-emerald-800' : 'bg-gold-light text-amber-800'}`}>
                    {o.status === 'ok' ? t('inRange') : t('warnFar')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && <p className="mt-3 text-sm text-slate-600">{t('hiddenCount', { n: hidden })}</p>}
    </div>
  );
}
