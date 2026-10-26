import { useCallback, useEffect, useState } from 'react';
import type { Category, DriveDistances, Listing, Order, Organisation, Persona, Product, SupplyWindow } from '../shared/types';
import type { ModelConfig } from '../shared/models';

export type Bootstrap = {
  config: ModelConfig; orgs: Organisation[]; categories: Category[]; products: Product[];
  listings: Listing[]; distances: DriveDistances;
};

const params = new URLSearchParams(location.search);
// Session and persona live in the URL so role links can be shared; fall back to the last values used.
export const ctx = {
  session: params.get('s') ?? localStorage.getItem('session') ?? 'default',
  persona: params.get('as') ?? localStorage.getItem('persona') ?? '',
};
localStorage.setItem('session', ctx.session);
if (ctx.persona) localStorage.setItem('persona', ctx.persona);

export function setPersona(id: string) {
  ctx.persona = id;
  if (id) localStorage.setItem('persona', id); else localStorage.removeItem('persona');
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-session': ctx.session,
      ...(ctx.persona ? { 'x-persona': ctx.persona } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error);
  return res.json();
}

/** Poll an endpoint every few seconds so role-players see each other's changes quickly. */
export function usePolled<T>(path: string, ms = 3000) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const load = useCallback(
    () => api<T>(path).then((d) => { setData(d); setError(undefined); }, (e) => setError(String(e.message))),
    [path],
  );
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, ms);
    return () => clearInterval(t);
  }, [load, ms]);
  return { data, error, reload: load };
}

export const useBootstrap = () => usePolled<Bootstrap>('/bootstrap');
export const useWindows = () => usePolled<SupplyWindow[]>('/windows', 5000);
export const useOrders = () => usePolled<Order[]>('/orders', 3000);
export const fetchPersonas = () => api<Persona[]>('/personas');
