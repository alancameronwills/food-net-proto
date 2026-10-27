import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DIMENSIONS, PRESETS, presetConfig, type ModelConfig } from '../../shared/models';
import type { Persona } from '../../shared/types';
import { api, ctx, type Bootstrap } from '../api';
import { WEEKDAYS } from '../../shared/delivery';
import { loc } from '../i18n';

export function ModelLab({ boot, personas, reload }: { boot: Bootstrap; personas: Persona[]; reload: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState('');
  const c = boot.config;
  // Hub days toggled in quick succession each build on the last click, not on a stale copy from the server
  const [hubLocal, setHubLocal] = useState<number[]>();
  // Changes go to the server one after another, so quick clicks cannot arrive out of order and undo each other
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const hubDays = hubLocal ?? c.hubDays;
  // Keep the operator's latest choice until the server's copy has caught up with it. Dropping back to the server's
  // copy as soon as a save finishes would build the next click on a stale list and undo the previous one.
  const sameDays = (a: number[], b: number[]) => [...a].sort().join() === [...b].sort().join();
  useEffect(() => { if (hubLocal && sameDays(hubLocal, c.hubDays)) setHubLocal(undefined); }, [c.hubDays, hubLocal]); // eslint-disable-line react-hooks/exhaustive-deps

  const [error, setError] = useState('');
  // A switch that did not save must say so, not quietly flick back
  const change = async (patch: Partial<ModelConfig>): Promise<boolean> => {
    let ok = true;
    try {
      setError('');
      await api('/config', { method: 'PUT', body: JSON.stringify(patch) });
    } catch (e) {
      ok = false;
      setError((e as Error).message);
    }
    reload();
    return ok;
  };
  const link = (id: string) => `${location.origin}/home?s=${ctx.session}&as=${id}`;
  const copy = async (id: string) => {
    await navigator.clipboard.writeText(link(id));
    setCopied(id);
    setTimeout(() => setCopied(''), 1500);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-brand">{t('modelLab')}</h1>
        <p className="text-slate-600">{t('modelLabIntro')}</p>
      </div>

      {error && <p role="alert" data-testid="lab-error" className="rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}

      <section data-testid="presets">
        <h2 className="text-lg font-semibold text-brand-dark">{t('presetsTitle')}</h2>
        <p className="mb-2 text-sm text-slate-600">{t('presetsHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PRESETS.map((p) => (
            <button key={p.id} data-testid={`preset-${p.id}`} onClick={() => change(presetConfig(p))}
              className="rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-brand hover:shadow-md">
              <div className="font-semibold text-brand">{loc(p.label)}</div>
              <div className="mt-1 text-xs text-slate-600">{loc(p.explain)}</div>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {DIMENSIONS.map((d) => {
          const active = d.options.find((o) => o.id === c[d.id]);
          return (
            <fieldset key={d.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <legend className="px-1 text-lg font-semibold text-brand-dark">{loc(d.label)}</legend>
              <div className="flex flex-wrap gap-2">
                {d.options.map((o) => (
                  <button key={o.id} onClick={() => change({ [d.id]: o.id })} aria-pressed={o.id === c[d.id]}
                    className={`rounded-full border px-3 py-1 text-sm font-medium ${o.id === c[d.id] ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white hover:border-brand'}`}>
                    {loc(o.label)}
                  </button>
                ))}
              </div>
              {active && <p className="mt-2 text-sm text-slate-600">{loc(active.explain)}</p>}
              {d.id === 'forecastOrdering' && c.forecastOrdering === 'pct_limit' && (
                <label className="mt-2 block text-sm">{t('forecastPct')}: <b>{Math.round(c.forecastPct * 100)}%</b>
                  <input type="range" min={0} max={100} step={5} value={Math.round(c.forecastPct * 100)}
                    onChange={(e) => change({ forecastPct: Number(e.target.value) / 100 })} className="block w-full accent-[#17357f]" />
                </label>
              )}
              {d.id === 'delivery' && c.delivery === 'hub_courier' && (
                <div className="mt-2 text-sm" data-testid="hub-days">
                  <div className="font-medium">{t('hubDaysLabel')}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                      const on = hubDays.includes(day);
                      return (
                        <button key={day} aria-pressed={on} onClick={() => {
                          const next = on ? hubDays.filter((x) => x !== day) : [...hubDays, day];
                          if (next.length === 0) return; // the hub must run on at least one day
                          setHubLocal(next);
                          queue.current = queue.current.then(() => change({ hubDays: next })).then((ok) => { if (!ok) setHubLocal(undefined); });
                        }}
                          className={`rounded border px-2 py-0.5 ${on ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white'}`}>{WEEKDAYS.en[day]}</button>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{t('hubDaysHint', { n: 2 })}</p>
                </div>
              )}
              {d.id === 'localRange' && c.localRange === 'flat' && (
                <label className="mt-2 block text-sm">{t('flatRadius')}: <b>{c.flatRadiusKm}</b>
                  <input type="range" min={10} max={150} step={5} value={c.flatRadiusKm}
                    onChange={(e) => change({ flatRadiusKm: Number(e.target.value) })} className="block w-full accent-[#17357f]" />
                </label>
              )}
            </fieldset>
          );
        })}
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-brand-dark">{t('shareLinks')}</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {personas.filter((p) => p.role !== 'operator').map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded border border-slate-100 p-2 text-sm">
              <span>{p.name} <span className="text-slate-500">({p.kind})</span></span>
              <button className="rounded bg-gold px-2 py-1 font-semibold text-brand-dark" onClick={() => copy(p.id)}>
                {copied === p.id ? t('copied') : t('copyLink')}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <button className="rounded border border-red-300 px-4 py-2 text-red-700 hover:bg-red-50"
        onClick={async () => { if (confirm(t('resetConfirm'))) { await api('/admin/reset', { method: 'POST' }); reload(); alert(t('resetDone')); } }}>
        {t('resetSession')}
      </button>
    </div>
  );
}
