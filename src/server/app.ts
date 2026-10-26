import { Hono, type Context } from 'hono';
import { session, type Session } from './db';
import {
  ensureSeeded, getConfig, getDistances, listCategories, listListings, listOrgs, listProducts,
  listWindows, resetSession, updateConfig,
} from './store';
import type { Organisation, Persona } from '../shared/types';

type Env = { Variables: { s: Session; persona?: Organisation } };

const SESSION_RE = /^[a-z0-9-]{1,32}$/;
const toPersona = ({ id, role, name, kind, town, blurb }: Organisation): Persona => ({ id, role, name, kind, town, blurb });

export const app = new Hono<Env>().basePath('/api');

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal error' }, 500);
});

app.get('/health', (c) => c.json({ ok: true }));

// Resolve the demo session (isolated dataset) and, optionally, the acting persona.
app.use('*', async (c, next) => {
  if (c.req.path.endsWith('/health')) return next();
  const id = c.req.header('x-session') ?? 'default';
  if (!SESSION_RE.test(id)) return c.json({ error: 'Invalid session id' }, 400);
  const s = session(id);
  await ensureSeeded(s); // first visit to a session seeds it (once, even if several arrive together)
  c.set('s', s);
  const personaId = c.req.header('x-persona');
  if (personaId) c.set('persona', (await listOrgs(s)).find((o) => o.id === personaId));
  await next();
});

const requireOperator = (c: Context<Env>) =>
  c.get('persona')?.role === 'operator' ? null : c.json({ error: 'Operator only' }, 403);

app.get('/personas', async (c) => c.json((await listOrgs(c.get('s'))).map(toPersona)));

app.get('/me', (c) => {
  const p = c.get('persona');
  return p ? c.json(toPersona(p)) : c.json({ error: 'Unknown persona' }, 404);
});

// Everything the client needs to render browse screens; small enough to fetch whole.
app.get('/bootstrap', async (c) => {
  const s = c.get('s');
  const [config, orgs, categories, products, listings, distances] = await Promise.all([
    getConfig(s), listOrgs(s), listCategories(s), listProducts(s), listListings(s), getDistances(s),
  ]);
  return c.json({ config, orgs, categories, products, listings, distances });
});

app.get('/windows', async (c) => c.json(await listWindows(c.get('s'))));

app.get('/config', async (c) => c.json(await getConfig(c.get('s'))));

app.put('/config', async (c) => {
  const denied = requireOperator(c);
  if (denied) return denied;
  const patch = await c.req.json().catch(() => null);
  if (!patch || typeof patch !== 'object') return c.json({ error: 'Invalid body' }, 400);
  return c.json(await updateConfig(c.get('s'), patch as Record<string, unknown>));
});

app.post('/admin/reset', async (c) => {
  const denied = requireOperator(c);
  if (denied) return denied;
  await resetSession(c.get('s').id);
  return c.json({ ok: true });
});
