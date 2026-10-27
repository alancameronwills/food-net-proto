import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DIMENSIONS } from '../shared/models';
import type { Persona } from '../shared/types';
import { ctx, fetchPersonas, setPersona, useBootstrap, type Bootstrap } from './api';
import { loc, setLang } from './i18n';
import { Picker } from './pages/Picker';
import { BuyerHome } from './pages/BuyerHome';
import { ProducerHome } from './pages/ProducerHome';
import { OperatorHome } from './pages/OperatorHome';
import { ErrorBoundary } from './ErrorBoundary';
import { EventsPanel } from './pages/EventsPanel';
import { FeedbackBox } from './pages/FeedbackBox';
import { ScenarioPanel } from './pages/ScenarioPanel';

const ROLE_COLOUR = { buyer: 'bg-brand', producer: 'bg-emerald-700', operator: 'bg-slate-800' } as const;

export function App() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const location = useLocation();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personasLoaded, setPersonasLoaded] = useState(false);
  const boot = useBootstrap();
  useEffect(() => { void fetchPersonas().then((p) => { setPersonas(p); setPersonasLoaded(true); }); }, []);
  const me = personas.find((p) => p.id === ctx.persona);

  const modelSummary = (b: Bootstrap) =>
    DIMENSIONS.filter((d) => ['market', 'operator', 'delivery'].includes(d.id))
      .map((d) => loc(d.options.find((o) => o.id === b.config[d.id])!.label))
      .join(' · ');

  return (
    <div className="min-h-screen pb-28">
      <header className="bg-brand text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold">
            <span className="inline-block h-6 w-6 rounded-sm bg-gold" aria-hidden />
            {t('title')}
          </Link>
          <span className="hidden text-sm text-blue-100 sm:inline">{t('tagline')}</span>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <EventsPanel boot={boot.data} signedIn={!!me} />
            <span className="rounded bg-brand-dark px-2 py-1">{t('session')}: <b>{ctx.session}</b></span>
            <button className="rounded bg-gold px-3 py-1 font-semibold text-brand-dark" onClick={() => setLang(i18n.language === 'cy' ? 'en' : 'cy')}>
              {t('language')}
            </button>
          </div>
        </div>
        {/* A reminder of what this is, in a red banner under the top line */}
        <p data-testid="subhead" className="bg-red-600 px-4 py-1 text-center text-sm font-semibold text-white">{t('subhead')}</p>
        {/* Presenter banner: who am I, which model is on */}
        <div className="bg-brand-dark text-sm">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
            {me ? (
              <span className={`rounded px-2 py-0.5 font-semibold text-white ${ROLE_COLOUR[me.role]}`}>
                {t('playingAs')}: {me.name} ({me.town})
              </span>
            ) : <span>—</span>}
            {boot.data && <span className="text-gold">{t('model')}: {modelSummary(boot.data)}</span>}
            <span className="ml-auto flex gap-3">
              {me?.role === 'operator' && <Link className="underline" to="/lab">{t('modelLab')}</Link>}
              {me && <button className="underline" onClick={() => { setPersona(''); nav('/'); }}>{t('switchPersona')}</button>}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {boot.error && <p className="mb-4 rounded bg-red-100 p-3 text-red-800">{t('error')} ({boot.error})</p>}
        <ErrorBoundary key={location.pathname}>
        {!personasLoaded && !boot.error ? <p>{t('loading')}</p> : (
          <Routes>
            <Route path="/" element={<Picker personas={personas} onPick={(p) => { setPersona(p.id); nav('/home'); }} />} />
            <Route path="/home" element={
              !me ? <Navigate to="/" /> :
              !boot.data ? <p>{t('loading')}</p> :
              me.role === 'buyer' ? <BuyerHome me={me} boot={boot.data} /> :
              me.role === 'producer' ? <ProducerHome me={me} boot={boot.data} reloadBoot={boot.reload} /> :
              <Navigate to="/lab" />
            } />
            <Route path="/lab" element={
              me?.role !== 'operator' ? <Navigate to="/" /> :
              !boot.data ? <p>{t('loading')}</p> :
              <OperatorHome boot={boot.data} personas={personas} reload={boot.reload} />
            } />
          </Routes>
        )}
        </ErrorBoundary>
      </main>
      <ScenarioPanel personas={personas} me={me} />
      <FeedbackBox signedIn={!!me} />
    </div>
  );
}
