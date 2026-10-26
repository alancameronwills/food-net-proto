import '../src/server/env-local';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/server/app';
import { ensureTable, session } from '../src/server/db';
import { addDays, mondayOf, todayIso } from '../src/shared/dates';
import type { Listing, SupplyWindow } from '../src/shared/types';

// Integration tests against DynamoDB Local (`npm run db:up`); skipped when it isn't running.
const dbUp = await ensureTable().then(() => true, () => false);

let n = 0;
const newSession = () => `it-${Date.now().toString(36)}-${n++}`;
const THIS_MONDAY = mondayOf(todayIso());

function client(sessionId: string, persona: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { 'x-session': sessionId, 'x-persona': persona, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return {
    get: (p: string) => call('GET', p),
    put: (p: string, b: unknown) => call('PUT', p, b),
    post: (p: string, b: unknown) => call('POST', p, b),
    del: (p: string) => call('DELETE', p),
  };
}

const LISTING = 'dyfed-dairy:milk-whole';

describe.skipIf(!dbUp)('producer stock API', () => {
  let sid: string;
  beforeAll(() => { sid = newSession(); });

  it('lets a producer change quantity and confidence of their own week', async () => {
    const p = client(sid, 'dyfed-dairy');
    const r = await p.put('/windows', { listingId: LISTING, start: THIS_MONDAY, qtyTotal: 321, confidence: 'forecast' });
    expect(r.status).toBe(200);
    expect(r.body.window).toMatchObject({ qtyTotal: 321, confidence: 'forecast', qtyReserved: 0 });
    const all = (await p.get('/windows')).body as SupplyWindow[];
    expect(all.find((w) => w.listingId === LISTING && w.start === THIS_MONDAY)?.qtyTotal).toBe(321);
  });

  it("refuses edits to someone else's listing, and by buyers", async () => {
    const body = { listingId: LISTING, start: THIS_MONDAY, qtyTotal: 5, confidence: 'in_stock' };
    expect((await client(sid, 'teifi-butchers').put('/windows', body)).status).toBe(403);
    expect((await client(sid, 'grand-hotel').put('/windows', body)).status).toBe(403);
    expect((await client(sid, 'operator').put('/windows', body)).status).toBe(200); // operator may help out
  });

  it('validates input', async () => {
    const p = client(sid, 'dyfed-dairy');
    const base = { listingId: LISTING, start: THIS_MONDAY, qtyTotal: 10, confidence: 'in_stock' };
    expect((await p.put('/windows', { ...base, start: addDays(THIS_MONDAY, 1) })).status).toBe(400); // not a Monday
    expect((await p.put('/windows', { ...base, start: addDays(THIS_MONDAY, 7 * 60) })).status).toBe(400); // too far ahead
    expect((await p.put('/windows', { ...base, qtyTotal: -1 })).status).toBe(400);
    expect((await p.put('/windows', { ...base, qtyTotal: 1.5 })).status).toBe(400);
    expect((await p.put('/windows', { ...base, confidence: 'maybe' })).status).toBe(400);
    expect((await p.put('/windows', { ...base, listingId: 'nope' })).status).toBe(404);
  });

  it('never lets quantity drop below what buyers have reserved', async () => {
    const s = session(sid);
    const start = addDays(THIS_MONDAY, 7);
    expect(await s.updateIf('WINDOW', `${LISTING}#${start}`, { qtyReserved: 40 })).toBe(true); // simulate an order
    const p = client(sid, 'dyfed-dairy');
    const low = await p.put('/windows', { listingId: LISTING, start, qtyTotal: 39, confidence: 'in_stock' });
    expect(low.status).toBe(409);
    expect(low.body.error).toMatch(/40 already reserved/);
    expect((await p.put('/windows', { listingId: LISTING, start, qtyTotal: 40, confidence: 'in_stock' })).status).toBe(200);
    expect((await p.del(`/windows?listingId=${LISTING}&start=${start}`)).status).toBe(409);
    expect((await p.del(`/listings/${LISTING}`)).status).toBe(409);
  });

  it('creates a new week when none exists, and bulk-adds only missing weeks', async () => {
    const prod = client(sid, 'dinas-catch');
    const listing = (await prod.get('/bootstrap')).body.listings.find((l: Listing) => l.producerId === 'dinas-catch');
    const far = addDays(THIS_MONDAY, 7 * 20);
    expect((await prod.put('/windows', { listingId: listing.id, start: far, qtyTotal: 12, confidence: 'provisional' })).status).toBe(200);
    const bulk = await prod.post('/windows/bulk', { listingId: listing.id, from: addDays(far, -7), weeks: 3, qtyTotal: 5, confidence: 'forecast' });
    expect(bulk.status).toBe(200);
    expect(bulk.body.created).toBe(2); // the middle week already existed
    const mine = ((await prod.get('/windows')).body as SupplyWindow[]).filter((w) => w.listingId === listing.id);
    expect(mine.find((w) => w.start === far)?.qtyTotal).toBe(12); // untouched by bulk
  });

  it('adds, prices (with volume tiers), edits and removes listings', async () => {
    const p = client(sid, 'dyfed-dairy');
    const add = await p.post('/listings', { productId: 'meat-lamb', pricePerUnit: 15, minOrder: 2, tiers: [{ minQty: 20, price: 13.5 }] });
    expect(add.status).toBe(200);
    expect(add.body.listing).toMatchObject({ id: 'dyfed-dairy:meat-lamb', tiers: [{ minQty: 20, price: 13.5 }] });
    expect((await p.post('/listings', { productId: 'meat-lamb', pricePerUnit: 15, minOrder: 2 })).status).toBe(409);
    expect((await p.post('/listings', { productId: 'unicorn', pricePerUnit: 15, minOrder: 2 })).status).toBe(400);
    expect((await p.post('/listings', { productId: 'veg-leek', pricePerUnit: 0, minOrder: 2 })).status).toBe(400);
    expect((await p.post('/listings', { productId: 'veg-leek', pricePerUnit: 5, minOrder: 2, tiers: [{ minQty: 10, price: 6 }] })).status).toBe(400); // tier must be cheaper

    const edit = await p.put('/listings/dyfed-dairy:meat-lamb', { pricePerUnit: 16, tiers: [] });
    expect(edit.body.listing).toMatchObject({ pricePerUnit: 16, minOrder: 2 });
    expect(edit.body.listing.tiers).toBeUndefined();

    await p.put('/windows', { listingId: 'dyfed-dairy:meat-lamb', start: THIS_MONDAY, qtyTotal: 9, confidence: 'in_stock' });
    expect((await p.del('/listings/dyfed-dairy:meat-lamb')).status).toBe(200);
    const after = (await p.get('/bootstrap')).body.listings as Listing[];
    expect(after.some((l) => l.id === 'dyfed-dairy:meat-lamb')).toBe(false);
    expect(((await p.get('/windows')).body as SupplyWindow[]).some((w) => w.listingId === 'dyfed-dairy:meat-lamb')).toBe(false);
  });

  it('keeps sessions separate', async () => {
    const other = newSession();
    await client(other, 'dyfed-dairy').put('/windows', { listingId: LISTING, start: THIS_MONDAY, qtyTotal: 777, confidence: 'in_stock' });
    const here = ((await client(sid, 'dyfed-dairy').get('/windows')).body as SupplyWindow[]).find((w) => w.listingId === LISTING && w.start === THIS_MONDAY);
    expect(here?.qtyTotal).not.toBe(777);
  });

  it('survives concurrent edits to the same week (one value wins, data stays valid)', async () => {
    const p = client(sid, 'dyfed-dairy');
    const start = addDays(THIS_MONDAY, 14);
    const results = await Promise.all([100, 200, 300, 400].map((q) => p.put('/windows', { listingId: LISTING, start, qtyTotal: q, confidence: 'forecast' })));
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    const w = ((await p.get('/windows')).body as SupplyWindow[]).find((x) => x.listingId === LISTING && x.start === start)!;
    expect([100, 200, 300, 400]).toContain(w.qtyTotal);
  });
});
