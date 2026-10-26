import type { ModelConfig } from '../shared/models';
import type { Organisation } from '../shared/types';
import type { Session } from './db';
import type { Result } from './producer';
import { activeScenario } from './scenarios';
import { getConfig } from './store';

const fail = (status: 400 | 403, error: string): Result<never> => ({ ok: false, status, error });

/**
 * A comment from someone using the prototype, stored with the screen they were on and the model settings in
 * force, so what members say can be read against the rules they were looking at. Kept when a session is reset.
 */
export type FeedbackItem = {
  id: string;
  at: string;
  who: { id: string; name: string; role: string };
  screen: string;
  mood?: 'up' | 'down';
  text: string;
  config: ModelConfig;
  scenario?: string;
};

export async function postFeedback(s: Session, actor: Organisation | undefined, body: Record<string, any>): Promise<Result<{ feedback: FeedbackItem }>> {
  if (!actor) return fail(403, 'Choose a role first');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return fail(400, 'Please write a comment');
  if (text.length > 1000) return fail(400, 'Comments can be up to 1000 characters');
  const at = new Date().toISOString();
  const item: FeedbackItem = {
    id: `${at}#${Math.random().toString(36).slice(2, 6)}`, at,
    who: { id: actor.id, name: actor.name, role: actor.role },
    screen: typeof body.screen === 'string' ? body.screen.slice(0, 80) : '',
    ...(body.mood === 'up' || body.mood === 'down' ? { mood: body.mood } : {}),
    text, config: await getConfig(s),
    ...((await activeScenario(s)) ? { scenario: (await activeScenario(s))!.id } : {}),
  };
  await s.put('FEEDBACK', item.id, item);
  return { ok: true, feedback: item };
}

export async function listFeedback(s: Session, actor: Organisation | undefined): Promise<Result<{ items: FeedbackItem[] }>> {
  if (actor?.role !== 'operator') return fail(403, 'Only the network operator can read feedback');
  const items = (await s.list<FeedbackItem>('FEEDBACK')).sort((a, b) => b.at.localeCompare(a.at));
  return { ok: true, items };
}

export async function clearFeedback(s: Session, actor: Organisation | undefined): Promise<Result> {
  if (actor?.role !== 'operator') return fail(403, 'Only the network operator can clear feedback');
  await s.clear(['FEEDBACK']);
  return { ok: true };
}
