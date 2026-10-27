import { addDays, isIsoDate, todayIso } from '../shared/dates';
import { MAX_DAYS_AHEAD } from '../shared/delivery';
import type { ExtraDay, Organisation } from '../shared/types';
import type { Session } from './db';
import type { Result } from './producer';
import { listExtraDays } from './store';

const fail = (status: 400 | 403 | 404 | 409, error: string): Result<never> => ({ ok: false, status, error });
const MAX_PER_PRODUCER = 40;

/** Producers manage their own; the operator may manage any (handy when presenting). */
function whose(actor: Organisation | undefined, producerId: unknown): string | Result<never> {
  if (actor?.role === 'producer') return actor.id;
  if (actor?.role === 'operator' && typeof producerId === 'string') return producerId;
  return fail(403, actor?.role === 'operator' ? 'Say which producer (producerId)' : 'Only producers can add delivery days');
}

/**
 * Add a one-off delivery day to a producer's usual rounds, for a special delivery. From then on buyers can order that
 * producer's products for that day like any other delivery day (if there is stock that week).
 */
export async function addExtraDay(s: Session, actor: Organisation | undefined, body: Record<string, any>): Promise<Result<{ extraDay: ExtraDay }>> {
  const who = whose(actor, body.producerId);
  if (typeof who !== 'string') return who;
  const producer = await s.get<Organisation>('ORG', who);
  if (!producer || producer.role !== 'producer') return fail(400, 'Unknown producer');
  if (!isIsoDate(body.date)) return fail(400, 'date must be YYYY-MM-DD');
  const today = todayIso();
  if (body.date <= today) return fail(400, 'A special delivery day must be tomorrow or later');
  if (body.date > addDays(today, MAX_DAYS_AHEAD)) return fail(400, 'That day is too far ahead');
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 120) : undefined;
  const mine = (await listExtraDays(s)).filter((e) => e.producerId === who);
  if (mine.length >= MAX_PER_PRODUCER && !mine.some((e) => e.date === body.date)) return fail(409, `At most ${MAX_PER_PRODUCER} special delivery days at a time; remove some first`);
  const extraDay: ExtraDay = { producerId: who, date: body.date, ...(note ? { note } : {}) };
  await s.put('EXTRADAY', `${who}#${body.date}`, extraDay);
  return { ok: true, extraDay };
}

export async function removeExtraDay(s: Session, actor: Organisation | undefined, date: string, producerId?: string): Promise<Result> {
  const who = whose(actor, producerId);
  if (typeof who !== 'string') return who;
  if (!(await s.get('EXTRADAY', `${who}#${date}`))) return fail(404, 'No such special delivery day');
  await s.remove('EXTRADAY', `${who}#${date}`);
  return { ok: true };
}
