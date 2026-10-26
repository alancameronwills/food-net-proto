import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Persona } from '../../shared/types';
import { useActivity, useOrders, useRequests, type Bootstrap } from '../api';
import { EventList } from './EventsPanel';
import { ModelLab } from './ModelLab';
import { Overview } from './Overview';
import { RunSheet } from './RunSheet';

type Tab = 'lab' | 'overview' | 'runs' | 'activity';

export function OperatorHome({ boot, personas, reload }: { boot: Bootstrap; personas: Persona[]; reload: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('lab');
  const { data: orders = [] } = useOrders();
  const { data: activity = [] } = useActivity();
  const { data: requests = [] } = useRequests();
  const tabs: [Tab, string][] = [['lab', t('labTab')], ['overview', t('overviewTab')], ['runs', t('runsTab')], ['activity', t('activityTab')]];
  return (
    <div>
      <div role="tablist" className="mb-4 flex gap-2 border-b-2 border-gold">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-t px-4 py-2 font-semibold ${tab === k ? 'bg-brand text-white' : 'text-brand hover:bg-brand-light'}`}>{label}</button>
        ))}
      </div>
      {tab === 'lab' && <ModelLab boot={boot} personas={personas} reload={reload} />}
      {tab === 'overview' && <Overview orders={orders} requests={requests} boot={boot} />}
      {tab === 'runs' && (
        <div className="space-y-3">
          <p className="text-slate-600">{t('runsIntro')}</p>
          <RunSheet orders={orders} boot={boot} />
        </div>
      )}
      {tab === 'activity' && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <p className="px-3 pt-2 text-sm text-slate-600">{t('activityHint')}</p>
          <EventList events={activity} boot={boot} testId="activity-list" />
        </div>
      )}
    </div>
  );
}
