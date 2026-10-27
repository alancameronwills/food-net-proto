import { useTranslation } from 'react-i18next';
import { buildRuns } from '../../shared/delivery';
import type { Order } from '../../shared/types';
import type { Bootstrap } from '../api';
import { loc } from '../i18n';
import { longDate } from './Browse';

/**
 * What has to be delivered, by date and buyer. For one producer this is their van's run sheet; for the operator
 * it is the whole network's plan, showing how many drops a hub round saves.
 */
export function RunSheet({ orders, boot, producerId }: { orders: Order[]; boot: Bootstrap; producerId?: string }) {
  const { t, i18n } = useTranslation();
  const orgs = new Map(boot.orgs.map((o) => [o.id, o]));
  const products = new Map(boot.products.map((p) => [p.id, p]));
  const areas = new Map(boot.areas.map((a) => [a.id, a]));
  const runs = buildRuns(producerId ? orders.filter((o) => o.producerId === producerId) : orders, boot.orgs);
  const hub = boot.config.delivery === 'hub_courier';

  if (runs.length === 0) return <p className="text-slate-600" data-testid="run-sheet-empty">{t('runSheetNone')}</p>;
  return (
    <div className="space-y-4" data-testid="run-sheet">
      {runs.map((run) => (
        <section key={run.date} data-testid={`run-${run.date}`} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-baseline gap-x-4">
            <h3 className="text-lg font-semibold text-brand">{longDate(run.date, i18n.language)}</h3>
            {!producerId && (
              <span className="text-sm text-slate-600" data-testid="drops">
                {t('dropsSeparate', { n: run.separateDrops })} · <b className={hub || boot.config.operator === 'hub' ? 'text-emerald-800' : ''}>{t('dropsHub', { n: run.consolidatedDrops })}</b>
              </span>
            )}
            {producerId && hub && <span className="text-sm text-slate-600">{t('hubCollects')}</span>}
          </div>
          <ul className="mt-2 divide-y divide-slate-100">
            {run.stops.map((stop) => {
              const buyer = orgs.get(stop.buyerId);
              const area = stop.area ? areas.get(stop.area) : undefined;
              return (
                <li key={stop.buyerId} className="py-2 text-sm" data-testid={`stop-${run.date}-${stop.buyerId}`}>
                  <div className="font-semibold">{buyer?.name} <span className="font-normal text-slate-500">· {buyer?.town}{area && ` · ${t('runStopArea')}: ${loc(area.name)}`}</span></div>
                  <ul className="ml-4 list-disc text-slate-700">
                    {stop.lines.map((l, i) => {
                      const p = products.get(l.productId);
                      return (
                        <li key={i}>{l.qty} {p && t(`units.${p.unit}`)} {p && loc(p.name)}
                          {!producerId && <span className="text-slate-500"> {t('fromProducer', { name: orgs.get(l.producerId)?.name })}</span>}
                          {l.note && <span className="italic text-slate-600" data-testid="run-note"> — “{l.note}”</span>}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
