import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SCENARIOS } from '../../shared/scenarios';
import { api, usePolled } from '../api';
import { loc } from '../i18n';
import { SCENARIO_CHANGED } from './ScenarioPanel';

/** The operator picks a guided scenario to run for the whole session. */
export function ScenarioLauncher() {
  const { t } = useTranslation();
  const { data, reload } = usePolled<{ active: { id: string } | null }>('/scenario', 3000);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);

  const start = async (id: string) => {
    if (!confirm(t('confirmStartScenario'))) return;
    try {
      setError('');
      await api('/admin/scenario', { method: 'POST', body: JSON.stringify({ id }) });
      setStarted(true);
      reload();
      window.dispatchEvent(new Event(SCENARIO_CHANGED));
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="space-y-3">
      <p className="text-slate-600">{t('scenariosIntro')}</p>
      {error && <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}
      {started && <p role="status" className="rounded bg-emerald-100 p-2 text-sm text-emerald-900">{t('scenarioStarted')}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {SCENARIOS.map((s) => (
          <article key={s.id} data-testid={`scenario-${s.id}`} className={`rounded-lg border p-4 shadow-sm ${s.available ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-semibold text-brand-dark">{loc(s.title)}</h3>
              {data?.active?.id === s.id && <span className="rounded bg-gold-light px-2 py-0.5 text-xs font-semibold text-amber-900">{t('scenarioRunning')}</span>}
            </div>
            <p className="mt-1 text-sm">{loc(s.summary)}</p>
            {s.available ? (
              <div className="mt-3 flex items-center gap-3">
                <button onClick={() => start(s.id)} className="rounded bg-brand px-4 py-1.5 font-semibold text-white hover:bg-brand-dark">{t('startScenario')}</button>
                <span className="text-xs text-slate-500">{t('stepsCount', { n: s.steps.length })}</span>
              </div>
            ) : <p className="mt-3 text-sm italic">{s.unavailableReason && loc(s.unavailableReason)}</p>}
          </article>
        ))}
      </div>
    </div>
  );
}
