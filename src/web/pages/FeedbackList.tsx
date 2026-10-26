import { useTranslation } from 'react-i18next';
import { DIMENSIONS } from '../../shared/models';
import { api, usePolled } from '../api';
import { loc } from '../i18n';

type Item = {
  id: string; at: string; who: { id: string; name: string; role: string }; screen: string; mood?: 'up' | 'down'; text: string;
  config: Record<string, unknown>; scenario?: string;
};

const optionLabel = (dim: (typeof DIMENSIONS)[number], id: unknown) => dim.options.find((o) => o.id === id)?.label.en ?? String(id);

/** The operator's view of everything people said, with the model settings each comment was made under. */
export function FeedbackList() {
  const { t } = useTranslation();
  const { data, reload } = usePolled<{ items: Item[] }>('/feedback', 4000);
  const items = data?.items ?? [];

  const csv = () => {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['time', 'who', 'role', 'screen', 'mood', 'scenario', 'comment', ...DIMENSIONS.map((d) => d.id)];
    const rows = items.map((i) => [i.at, i.who.name, i.who.role, i.screen, i.mood ?? '', i.scenario ?? '', i.text, ...DIMENSIONS.map((d) => optionLabel(d, i.config[d.id]))]);
    const blob = new Blob([[head, ...rows].map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `feedback-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <button disabled={items.length === 0} onClick={csv} className="rounded border border-brand px-3 py-1 text-brand hover:bg-brand-light disabled:opacity-40">{t('feedbackDownload')}</button>
        <button disabled={items.length === 0} className="rounded border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50 disabled:opacity-40"
          onClick={async () => { if (confirm(t('feedbackConfirmClear'))) { await api('/feedback', { method: 'DELETE' }); reload(); } }}>{t('feedbackClear')}</button>
      </div>
      {items.length === 0 ? <p className="text-slate-600">{t('feedbackNone')}</p> : (
        <ul className="space-y-2" data-testid="feedback-list">
          {items.map((i) => (
            <li key={i.id} data-testid="feedback-item" className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
                <b className="text-slate-900">{i.who.name}</b>
                <span>{i.screen || '—'}</span>
                {i.mood && <span aria-label={i.mood}>{i.mood === 'up' ? '👍' : '👎'}</span>}
                {i.scenario && <span className="rounded bg-gold-light px-1.5 text-xs">{t('feedbackScenarioCol')}: {i.scenario}</span>}
                <span className="ml-auto text-xs">{new Date(i.at).toLocaleString()}</span>
              </div>
              <p className="mt-1">{i.text}</p>
              <p className="mt-1 text-xs text-slate-500" data-testid="feedback-model">
                {t('feedbackModel')}: {DIMENSIONS.filter((d) => ['market', 'operator', 'delivery', 'stockTrigger', 'speculative'].includes(d.id)).map((d) => `${loc(d.label)}: ${optionLabel(d, i.config[d.id])}`).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
