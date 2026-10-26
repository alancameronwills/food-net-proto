import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, useActivity, useNotifications, type AppEvent, type Bootstrap } from '../api';
import { loc } from '../i18n';

/** One sentence describing an event, in the current language. */
export function eventText(t: (k: string, o?: Record<string, unknown>) => string, boot: Bootstrap | undefined, e: AppEvent): string {
  const p = e.params;
  const product = p.productId ? boot?.products.find((x) => x.id === p.productId) : undefined;
  return t(`ev_${e.type}`, {
    ...p,
    product: product ? loc(product.name) : '',
    reason: p.reason ? `: ${p.reason}` : '',
    price: p.price !== undefined ? p.price.toFixed(2) : '',
  });
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function EventList({ events, boot, testId }: { events: AppEvent[]; boot?: Bootstrap; testId?: string }) {
  const { t } = useTranslation();
  if (events.length === 0) return <p className="p-3 text-sm text-slate-500">{t('nothingYet')}</p>;
  return (
    <ul data-testid={testId} className="divide-y divide-slate-100">
      {events.map((e, i) => (
        <li key={e.id ?? `${e.at}-${i}`} className={`flex gap-2 p-2 text-sm ${e.read === false ? 'bg-gold-light/60 font-medium' : ''}`}>
          <span className="shrink-0 text-xs text-slate-500">{clock(e.at)}</span>
          <span>{eventText(t, boot, e)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Header controls: a bell with this organisation's notifications, and a drop-down of what is happening across the network. */
export function EventsPanel({ boot, signedIn }: { boot?: Bootstrap; signedIn: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<'none' | 'bell' | 'feed'>('none');
  const notifications = useNotifications();
  const activity = useActivity(open === 'feed' ? 3000 : 15000);
  const box = useRef<HTMLDivElement>(null);
  const unread = (notifications.data ?? []).filter((n) => !n.read).length;

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen('none'); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const openBell = () => {
    setOpen(open === 'bell' ? 'none' : 'bell');
  };
  const markRead = async () => { await api('/notifications/read', { method: 'POST' }); notifications.reload(); };

  return (
    <div ref={box} className="relative flex gap-2">
      {signedIn && (
        <button aria-label={t('notifications')} data-testid="bell" onClick={openBell} className="relative rounded bg-brand-dark px-3 py-1 hover:bg-blue-900">
          🔔{unread > 0 && <span data-testid="bell-count" className="ml-1 rounded-full bg-gold px-1.5 text-xs font-bold text-brand-dark">{unread}</span>}
        </button>
      )}
      <button onClick={() => setOpen(open === 'feed' ? 'none' : 'feed')} data-testid="feed-toggle" className="rounded bg-brand-dark px-3 py-1 hover:bg-blue-900">{t('activity')}</button>
      {open !== 'none' && (
        <div data-testid={open === 'bell' ? 'bell-panel' : 'feed-panel'} className="absolute right-0 top-10 z-20 max-h-96 w-96 max-w-[90vw] overflow-y-auto rounded-lg border border-slate-200 bg-white text-slate-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 p-2">
            <b>{open === 'bell' ? t('notifications') : t('activity')}</b>
            {open === 'bell' && unread > 0 && <button className="text-sm text-brand underline" onClick={markRead}>{t('markRead')}</button>}
          </div>
          {open === 'feed' && <p className="px-3 pt-2 text-xs text-slate-500">{t('activityHint')}</p>}
          <EventList events={(open === 'bell' ? notifications.data : activity.data) ?? []} boot={boot} />
        </div>
      )}
    </div>
  );
}
