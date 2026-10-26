import { Hono, type Context } from 'hono';
import { session, type Session } from './db';
import {
  ensureSeeded, getConfig, getDistances, listAreas, listCategories, listListings, listOrgs, listProducts,
  listWindows, resetSession, updateConfig,
} from './store';
import type { Organisation, Persona } from '../shared/types';
import { cancelOrder, confirmOrder, declineOrder, deliverOrder, dismissFlags, listOrders, pickOrder, placeOrders } from './orders';
import { acceptBid, closeRequest, createRequest, listRequests, placeBid, takeRequest, withdrawBid } from './requests';
import { markAllRead, notificationsFor, recentActivity } from './events';
import { reliabilityFor } from '../shared/reliability';
import { addListing, addWeeks, removeListing, removeWindow, updateListing, upsertWindow, type Result } from './producer';

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
  const [config, orgs, categories, products, listings, distances, areas] = await Promise.all([
    getConfig(s), listOrgs(s), listCategories(s), listProducts(s), listListings(s), getDistances(s), listAreas(s),
  ]);
  const reliability = reliabilityFor(orgs, await s.list('ORDER'));
  return c.json({ config, orgs, categories, products, listings, distances, reliability, areas });
});

app.get('/windows', async (c) => c.json(await listWindows(c.get('s'))));

// Producer stock management. Producers edit their own listings; the operator may edit any.
const reply = (c: Context<Env>, r: Result<Record<string, unknown>>) => {
  if (r.ok) { const { ok: _ok, ...rest } = r; return c.json(rest); }
  return c.json({ error: r.error }, r.status);
};
const jsonBody = async (c: Context<Env>): Promise<Record<string, any>> => {
  const b = await c.req.json().catch(() => null);
  return b && typeof b === 'object' ? b : {};
};

app.post('/listings', async (c) => reply(c, await addListing(c.get('s'), c.get('persona'), await jsonBody(c))));
app.put('/listings/:id', async (c) => reply(c, await updateListing(c.get('s'), c.get('persona'), c.req.param('id'), await jsonBody(c))));
app.delete('/listings/:id', async (c) => reply(c, await removeListing(c.get('s'), c.get('persona'), c.req.param('id'))));
app.put('/windows', async (c) => reply(c, await upsertWindow(c.get('s'), c.get('persona'), await jsonBody(c))));
app.post('/windows/bulk', async (c) => reply(c, await addWeeks(c.get('s'), c.get('persona'), await jsonBody(c))));
app.delete('/windows', async (c) =>
  reply(c, await removeWindow(c.get('s'), c.get('persona'), c.req.query('listingId') ?? '', c.req.query('start') ?? '')));

// Orders: buyers place and cancel; producers confirm or decline; each sees only their own.
app.get('/orders', async (c) => c.json(await listOrders(c.get('s'), c.get('persona'))));
app.post('/orders', async (c) => reply(c, await placeOrders(c.get('s'), c.get('persona'), await jsonBody(c))));
app.post('/orders/:id/confirm', async (c) => reply(c, await confirmOrder(c.get('s'), c.get('persona'), c.req.param('id'))));
app.post('/orders/:id/decline', async (c) =>
  reply(c, await declineOrder(c.get('s'), c.get('persona'), c.req.param('id'), (await jsonBody(c)).reason)));
app.post('/orders/:id/pick', async (c) => reply(c, await pickOrder(c.get('s'), c.get('persona'), c.req.param('id'))));
app.post('/orders/:id/deliver', async (c) =>
  reply(c, await deliverOrder(c.get('s'), c.get('persona'), c.req.param('id'), (await jsonBody(c)).lines)));
app.post('/orders/:id/dismiss-flags', async (c) => reply(c, await dismissFlags(c.get('s'), c.get('persona'), c.req.param('id'))));
app.post('/orders/:id/cancel', async (c) => reply(c, await cancelOrder(c.get('s'), c.get('persona'), c.req.param('id'))));

// Speculative orders: buyers ask, producers bid (or accept the buyer's price), buyers choose.
app.get('/requests', async (c) => c.json(await listRequests(c.get('s'), c.get('persona'))));
app.post('/requests', async (c) => reply(c, await createRequest(c.get('s'), c.get('persona'), await jsonBody(c))));
app.post('/requests/:id/bids', async (c) => reply(c, await placeBid(c.get('s'), c.get('persona'), c.req.param('id'), await jsonBody(c))));
app.post('/requests/:id/bids/:bid/withdraw', async (c) => reply(c, await withdrawBid(c.get('s'), c.get('persona'), c.req.param('id'), c.req.param('bid'))));
app.post('/requests/:id/accept', async (c) => reply(c, await acceptBid(c.get('s'), c.get('persona'), c.req.param('id'), (await jsonBody(c)).bidId)));
app.post('/requests/:id/take', async (c) => reply(c, await takeRequest(c.get('s'), c.get('persona'), c.req.param('id'))));
app.post('/requests/:id/close', async (c) => reply(c, await closeRequest(c.get('s'), c.get('persona'), c.req.param('id'))));

// Notifications for the acting organisation, and the network-wide activity feed.
app.get('/notifications', async (c) => {
  const p = c.get('persona');
  return c.json(p ? await notificationsFor(c.get('s'), p.id) : []);
});
app.post('/notifications/read', async (c) => {
  const p = c.get('persona');
  if (p) await markAllRead(c.get('s'), p.id);
  return c.json({ ok: true });
});
app.get('/activity', async (c) => c.json(await recentActivity(c.get('s'))));

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
