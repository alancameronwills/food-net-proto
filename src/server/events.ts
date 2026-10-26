import type { Session } from './db';

/**
 * Things worth telling people about. One event is written to the network activity feed
 * (visible to everyone, so a Zoom audience can follow along) and to each recipient's notifications.
 * Only structured data is stored; the screens turn it into English or Welsh text.
 */
export type EventType =
  | 'order_placed' | 'order_confirmed' | 'order_declined' | 'order_cancelled'
  | 'order_picked' | 'order_delivered' | 'order_short' | 'supply_cut'
  | 'request_new' | 'request_closed' | 'bid_placed' | 'bid_accepted' | 'bid_rejected' | 'request_filled';

export type EventParams = {
  orderId?: string; requestId?: string;
  buyer?: string; producer?: string; /** display names */
  productId?: string; qty?: number; price?: number; reason?: string; date?: string;
};

export type ActivityItem = { at: string; type: EventType; params: EventParams };
export type Notification = ActivityItem & { id: string; to: string; read: boolean };

const rand = () => Math.random().toString(36).slice(2, 6);
const FEED_LIMIT = 40;
const NOTIF_LIMIT = 30;

export async function emit(s: Session, type: EventType, params: EventParams, to: string[] = []): Promise<void> {
  const at = new Date().toISOString();
  const item: ActivityItem = { at, type, params };
  await s.put('ACTIVITY', `${at}#${rand()}`, item);
  await Promise.all([...new Set(to)].map((org) => {
    const id = `${org}#${at}#${rand()}`;
    return s.put('NOTIF', id, { ...item, id, to: org, read: false });
  }));
}

export async function recentActivity(s: Session): Promise<ActivityItem[]> {
  const all = await s.list<ActivityItem>('ACTIVITY');
  return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, FEED_LIMIT);
}

export async function notificationsFor(s: Session, orgId: string): Promise<Notification[]> {
  const all = await s.list<Notification>('NOTIF', `${orgId}#`);
  return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, NOTIF_LIMIT);
}

export async function markAllRead(s: Session, orgId: string): Promise<void> {
  for (const n of await notificationsFor(s, orgId)) {
    if (!n.read) await s.updateIf('NOTIF', n.id, { read: true });
  }
}
