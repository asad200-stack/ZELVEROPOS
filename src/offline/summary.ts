import { needsAction, type OfflineOperation } from './types';

/** Payment physically taken for sales NOT (yet) recorded in the official drawer: open or unresolved-failed ones. */
export function cashHeldOffline(ops: OfflineOperation[]) {
  const held = ops.filter((op) => op.status === 'PENDING_SYNC' || op.status === 'SYNCING' || needsAction(op));
  return held.reduce(
    (sum, op) => ({ count: sum.count + 1, usdCents: sum.usdCents + op.snapshot.received.usdCents, lbp: sum.lbp + op.snapshot.received.lbp }),
    { count: 0, usdCents: 0, lbp: 0 },
  );
}

const isOpen = (op: OfflineOperation) => op.status === 'PENDING_SYNC' || op.status === 'SYNCING' || needsAction(op);

/**
 * What a signed-in user may see of the device queue: only their own operations. Other users of the
 * same store are reduced to a count; other stores are invisible. Nothing is deleted.
 */
export function visibleQueue(ops: OfflineOperation[], who: { tenantId: string; uid: string }) {
  return {
    own: ops.filter((op) => op.tenantId === who.tenantId && op.uid === who.uid),
    othersInStore: ops.filter((op) => op.tenantId === who.tenantId && op.uid !== who.uid && isOpen(op)).length,
  };
}

export function summarize(ops: OfflineOperation[]) {
  return {
    pending: ops.filter((op) => op.status === 'PENDING_SYNC' || op.status === 'SYNCING').length,
    actionRequired: ops.filter(needsAction).length,
    outsideDrawer: cashHeldOffline(ops),
  };
}
