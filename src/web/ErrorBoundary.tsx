import { Component, type ReactNode } from 'react';
import i18n from './i18n';

/** If a screen throws, say so and offer a reload, instead of leaving a blank page in front of an audience. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Screen crashed', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" data-testid="crash" className="rounded-lg border-2 border-red-300 bg-red-50 p-4 text-red-900">
        <h2 className="text-lg font-bold">{i18n.t('crashTitle')}</h2>
        <p className="mt-1 text-sm">{i18n.t('crashHint')}</p>
        <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs">{this.state.error.message}</pre>
        <button className="mt-3 rounded bg-brand px-4 py-1.5 font-semibold text-white" onClick={() => location.reload()}>{i18n.t('crashReload')}</button>
      </div>
    );
  }
}
