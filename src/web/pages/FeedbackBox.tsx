import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { screen } from '../screen';

/** A small always-available box for comments; each one is saved with the screen and the model settings in force. */
export function FeedbackBox({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [mood, setMood] = useState<'up' | 'down'>();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  if (!signedIn) return null;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError('');
      await api('/feedback', { method: 'POST', body: JSON.stringify({ text, mood, screen: screen.name }) });
      setText(''); setMood(undefined); setSent(true);
      setTimeout(() => { setSent(false); setOpen(false); }, 1800);
    } catch (err) { setError((err as Error).message); }
  };

  return (
    <div className="fixed bottom-4 right-4 z-30">
      {open ? (
        <form data-testid="feedback-form" onSubmit={send} className="w-80 max-w-[92vw] space-y-2 rounded-lg border-2 border-brand bg-white p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <b className="text-brand">{t('feedbackTitle')}</b>
            <button type="button" aria-label={t('cancel')} className="text-slate-500" onClick={() => setOpen(false)}>×</button>
          </div>
          <p className="text-xs text-slate-600">{t('feedbackHint')}</p>
          {sent ? <p role="status" className="rounded bg-emerald-100 p-2 text-sm text-emerald-900">{t('feedbackThanks')}</p> : (
            <>
              <textarea required value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={1000} placeholder={t('feedbackPlaceholder')} aria-label={t('feedbackComment')}
                className="w-full rounded border border-slate-300 p-2 text-sm" />
              <div className="flex items-center gap-2">
                {(['up', 'down'] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={mood === m} aria-label={t(m === 'up' ? 'thumbsUp' : 'thumbsDown')} onClick={() => setMood(mood === m ? undefined : m)}
                    className={`rounded border px-3 py-1 ${mood === m ? 'border-brand bg-brand-light' : 'border-slate-300'}`}>{m === 'up' ? '👍' : '👎'}</button>
                ))}
                <button className="ml-auto rounded bg-brand px-4 py-1.5 font-semibold text-white">{t('feedbackSend')}</button>
              </div>
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            </>
          )}
        </form>
      ) : (
        <button data-testid="feedback-open" onClick={() => setOpen(true)} className="rounded-full bg-brand px-4 py-2 font-semibold text-white shadow-lg hover:bg-brand-dark">💬 {t('feedbackBtn')}</button>
      )}
    </div>
  );
}
