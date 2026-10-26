import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { scenarioById, stepStates } from '../../shared/scenarios';
import type { Persona } from '../../shared/types';
import { api, ctx, useActivity, usePolled } from '../api';
import { loc } from '../i18n';

export const SCENARIO_CHANGED = 'scenario-changed';
type Active = { active: { id: string; startedAt: string } | null };

/** A slim bar along the bottom showing the current step of the guided scenario; the full checklist opens above it. */
export function ScenarioPanel({ personas, me }: { personas: Persona[]; me?: Persona }) {
  const { data, reload } = usePolled<Active>('/scenario', 3000);
  // Starting or ending a scenario from the operator screen updates the bar at once, not on the next poll
  useEffect(() => {
    window.addEventListener(SCENARIO_CHANGED, reload);
    return () => window.removeEventListener(SCENARIO_CHANGED, reload);
  }, [reload]);
  if (!data?.active) return null;
  return <Running active={data.active} personas={personas} me={me} reload={reload} />;
}

function Running({ active, personas, me, reload }: { active: { id: string; startedAt: string }; personas: Persona[]; me?: Persona; reload: () => void }) {
  const { t } = useTranslation();
  const scenario = scenarioById(active.id);
  const { data: events = [] } = useActivity(3000);
  const key = `scn:${ctx.session}:${active.id}:${active.startedAt}`;
  const [manual, setManual] = useState<Set<number>>(() => new Set(JSON.parse(localStorage.getItem(key) ?? '[]')));
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { localStorage.setItem(key, JSON.stringify([...manual])); }, [manual, key]);
  if (!scenario) return null;

  const done = stepStates(scenario, events.filter((e) => e.at >= active.startedAt), manual);
  const current = done.findIndex((d) => !d);
  const finished = done.filter(Boolean).length;
  const nameOf = (who: string) => (who === 'operator' ? t('operatorRole') : personas.find((p) => p.id === who)?.name ?? who);
  const go = (who: string) => window.location.assign(`/${who === 'operator' ? 'lab' : 'home'}?s=${ctx.session}&as=${who}`);
  const tick = (i: number) => setManual(new Set([...manual, i]));

  if (hidden) {
    return (
      <button data-testid="scenario-tab" onClick={() => setHidden(false)} className="fixed bottom-4 left-4 z-30 rounded-full bg-gold px-4 py-2 font-semibold text-brand-dark shadow-lg">
        {t('scenarioLabel')}: {loc(scenario.title)} ({finished}/{scenario.steps.length})
      </button>
    );
  }

  const step = current >= 0 ? scenario.steps[current] : undefined;
  return (
    <aside data-testid="scenario-panel" className="fixed inset-x-0 bottom-0 z-30 border-t-4 border-gold bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.15)]">
      {expanded && (
        <div className="absolute bottom-full left-0 max-h-[60vh] w-[28rem] max-w-full overflow-y-auto border-2 border-b-0 border-gold bg-white p-3">
          <p className="text-sm text-slate-600">{loc(scenario.summary)}</p>
          <ol className="mt-2 space-y-2">
            {scenario.steps.map((s, i) => (
              <li key={i} data-testid={`scenario-step-${i}`} data-done={done[i]} className={`rounded border p-2 text-sm ${i === current ? 'border-gold bg-gold-light/50' : 'border-slate-200'} ${done[i] ? 'opacity-70' : ''}`}>
                <div className="flex gap-2">
                  <span aria-hidden className={done[i] ? 'text-emerald-700' : 'text-slate-400'}>{done[i] ? '✔' : '○'}</span>
                  <span className={done[i] ? 'line-through' : ''}>{loc(s.text)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 pl-6 text-xs">
                  {me?.id === s.who ? <span className="font-semibold text-emerald-800">{t('youAreHere')}</span> : (
                    <button className="rounded border border-brand px-2 py-0.5 text-brand hover:bg-brand-light" onClick={() => go(s.who)}>{t('playAs', { name: nameOf(s.who) })}</button>
                  )}
                  {!s.done && !done[i] && <button className="rounded bg-slate-100 px-2 py-0.5 hover:bg-slate-200" onClick={() => tick(i)}>{t('markDone')}</button>}
                </div>
              </li>
            ))}
          </ol>
          {me?.role === 'operator' && (
            <button data-testid="end-scenario" className="mt-3 text-sm text-red-700 underline"
              onClick={async () => { await api('/admin/scenario', { method: 'DELETE' }); reload(); window.dispatchEvent(new Event(SCENARIO_CHANGED)); }}>{t('endScenario')}</button>
          )}
        </div>
      )}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 pr-44 text-sm">
        <span className="font-bold text-brand">{t('scenarioLabel')}: {loc(scenario.title)}</span>
        <span data-testid="scenario-progress" className="text-xs font-medium text-slate-500">{t('scenarioProgress', { a: finished, b: scenario.steps.length })}</span>
        {step ? (
          <span data-testid="scenario-current" className="min-w-0 flex-1 basis-80 truncate" title={loc(step.text)}>{loc(step.text)}</span>
        ) : <span className="flex-1 font-semibold text-emerald-800">✔</span>}
        {step && me?.id !== step.who && (
          <button className="rounded border border-brand px-2 py-0.5 text-brand hover:bg-brand-light" onClick={() => go(step.who)}>{t('playAs', { name: nameOf(step.who) })}</button>
        )}
        {step && !step.done && <button className="rounded bg-slate-100 px-2 py-0.5 hover:bg-slate-200" onClick={() => tick(current)}>{t('markDone')}</button>}
        <button data-testid="scenario-expand" aria-expanded={expanded} className="underline" onClick={() => setExpanded(!expanded)}>{expanded ? '▼' : '▲'} {t('scenarioSteps')}</button>
        <button className="text-slate-500 underline" onClick={() => setHidden(true)}>{t('hidePanel')}</button>
      </div>
    </aside>
  );
}
