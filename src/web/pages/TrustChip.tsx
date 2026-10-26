import { useTranslation } from 'react-i18next';
import { capabilities } from '../../shared/models';
import type { Bootstrap } from '../api';

/** How much to trust a producer, shown according to the trust model the operator has chosen. */
export function TrustChip({ producerId, boot }: { producerId: string; boot: Bootstrap }) {
  const { t } = useTranslation();
  const caps = capabilities(boot.config);
  if (caps.showBadges) {
    return boot.orgs.find((o) => o.id === producerId)?.verified
      ? <span data-testid="trust" className="rounded bg-brand-light px-1.5 text-xs font-semibold text-brand">✓ {t('verified')}</span>
      : null;
  }
  if (!caps.showReliability) return null;
  const r = boot.reliability?.[producerId];
  if (!r || r.score === null) return <span data-testid="trust" className="text-xs text-slate-500">{t('noRecord')}</span>;
  const pct = Math.round(r.score * 100);
  const tone = pct >= 95 ? 'bg-emerald-100 text-emerald-800' : pct >= 90 ? 'bg-gold-light text-amber-900' : 'bg-red-100 text-red-800';
  return (
    <span data-testid="trust" className={`rounded px-1.5 text-xs font-semibold ${tone}`} title={t('reliabilityOrders', { n: r.orders })}>
      ★ {t('reliability', { pct })} · {t('reliabilityOrders', { n: r.orders })}
    </span>
  );
}
