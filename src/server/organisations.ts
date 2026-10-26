import type { Listing, Organisation } from '../shared/types';

/**
 * Parse and validate data/organisations.json. Errors name the offending entry so the
 * file can be edited by hand without reading code.
 */
export function parseOrganisations(raw: unknown, productIds: Set<string>): { orgs: Organisation[]; listings: Listing[] } {
  const problems: string[] = [];
  if (!Array.isArray(raw)) throw new Error('data/organisations.json must be a list of organisations');

  const orgs: Organisation[] = [];
  const listings: Listing[] = [];
  const seen = new Set<string>();
  const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  raw.forEach((r: Record<string, any>, i) => {
    const at = `entry ${i + 1}${isStr(r?.id) ? ` ("${r.id}")` : ''}`;
    const bad = (msg: string) => problems.push(`${at}: ${msg}`);
    if (!r || typeof r !== 'object') return bad('not an object');
    if (!isStr(r.id) || !/^[a-z0-9-]+$/.test(r.id)) return bad('"id" must be lowercase letters, digits and hyphens');
    if (seen.has(r.id)) return bad('duplicate "id"');
    seen.add(r.id);
    if (!['buyer', 'producer', 'operator'].includes(r.role)) bad('"role" must be buyer, producer or operator');
    for (const f of ['name', 'kind', 'town']) if (!isStr(r[f])) bad(`"${f}" is required`);
    if (!isNum(r.lat) || r.lat < 51 || r.lat > 53) bad('"lat" must be a number (Pembrokeshire is about 51.6 to 52.1)');
    if (!isNum(r.lon) || r.lon < -6 || r.lon > -3.5) bad('"lon" must be a number (Pembrokeshire is about -5.4 to -4.4)');
    if (!isStr(r.blurb?.en)) bad('"blurb.en" is required (blurb.cy is optional and falls back to English)');

    if (r.role === 'producer') {
      if (!Array.isArray(r.offers) || r.offers.length === 0) bad('producers need at least one entry in "offers"');
      const offered = new Set<string>();
      (r.offers ?? []).forEach((o: Record<string, any>, j: number) => {
        if (!productIds.has(o?.product)) return bad(`offers[${j}]: unknown product "${o?.product}" (known: ${[...productIds].join(', ')})`);
        if (offered.has(o.product)) return bad(`offers[${j}]: "${o.product}" listed twice`);
        offered.add(o.product);
        if (!isNum(o.price) || o.price <= 0) return bad(`offers[${j}]: "price" must be a positive number`);
        if (!isNum(o.minOrder) || o.minOrder <= 0) return bad(`offers[${j}]: "minOrder" must be a positive number`);
        listings.push({
          id: `${r.id}:${o.product}`, producerId: r.id, productId: o.product,
          pricePerUnit: o.price, minOrder: o.minOrder, certifications: Array.isArray(r.certifications) ? r.certifications : [],
        });
      });
    } else if (r.offers) bad('only producers can have "offers"');

    orgs.push({
      id: r.id, role: r.role, name: r.name, kind: r.kind, town: r.town, lat: r.lat, lon: r.lon,
      blurb: { en: r.blurb?.en, cy: isStr(r.blurb?.cy) ? r.blurb.cy : r.blurb?.en },
    });
  });

  const count = (role: string) => orgs.filter((o) => o.role === role).length;
  if (count('operator') !== 1) problems.push(`there must be exactly one operator (found ${count('operator')})`);
  if (count('buyer') < 1) problems.push('there must be at least one buyer');
  if (count('producer') < 1) problems.push('there must be at least one producer');

  if (problems.length) throw new Error(`Invalid data/organisations.json:\n - ${problems.join('\n - ')}`);
  return { orgs, listings };
}
