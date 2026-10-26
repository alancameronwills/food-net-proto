import { useTranslation } from 'react-i18next';
import type { Persona, Role } from '../../shared/types';
import { loc } from '../i18n';
import { useScreen } from '../screen';

export function Picker({ personas, onPick }: { personas: Persona[]; onPick: (p: Persona) => void }) {
  const { t } = useTranslation();
  useScreen('role picker');
  const groups: [Role, string][] = [['buyer', t('buyers')], ['producer', t('producers')], ['operator', t('operatorRole')]];
  return (
    <div>
      <h1 className="text-3xl font-bold text-brand">{t('chooseRole')}</h1>
      <p className="mt-1 mb-6 max-w-2xl text-slate-600">{t('chooseHint')}</p>
      {groups.map(([role, label]) => (
        <section key={role} className="mb-8">
          <h2 className="mb-3 border-b-2 border-gold pb-1 text-xl font-semibold text-brand-dark">{label}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {personas.filter((p) => p.role === role).map((p) => (
              <button key={p.id} onClick={() => onPick(p)}
                className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand hover:shadow-md focus:outline-2 focus:outline-brand">
                <div className="text-lg font-semibold text-brand">{p.name}</div>
                <div className="text-sm text-slate-500">{p.kind} · {p.town}</div>
                <div className="mt-2 text-sm">{loc(p.blurb)}</div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
