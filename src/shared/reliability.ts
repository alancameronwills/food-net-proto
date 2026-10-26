import type { Order, Organisation } from './types';

export type Reliability = {
  /** Share of ordered quantity actually delivered (0-1), or null when there is no record yet. */
  score: number | null;
  /** Number of completed orders behind the score (past record plus this session). */
  orders: number;
};

/**
 * Delivery reliability per producer: each finished order counts by how much of it arrived (a short
 * delivery counts partly), blended with the producer's past record from the organisations file.
 */
export function reliabilityFor(orgs: Organisation[], orders: Order[]): Record<string, Reliability> {
  const out: Record<string, Reliability> = {};
  for (const o of orgs) {
    if (o.role !== 'producer') continue;
    const finished = orders.filter((x) => x.producerId === o.id && (x.status === 'delivered' || x.status === 'short'));
    const fills = finished.map((x) => {
      const ordered = x.lines.reduce((n, l) => n + l.qty, 0);
      const got = (x.delivered ?? x.lines).reduce((n, l) => n + l.qty, 0);
      return ordered > 0 ? got / ordered : 1;
    });
    const base = o.baseline ?? { orders: 0, fillRate: 0 };
    const n = fills.length + base.orders;
    out[o.id] = {
      orders: n,
      score: n === 0 ? null : (fills.reduce((a, b) => a + b, 0) + base.orders * base.fillRate) / n,
    };
  }
  return out;
}
