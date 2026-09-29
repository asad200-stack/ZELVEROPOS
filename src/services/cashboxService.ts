import {
  doc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { lbpToUsdCents } from '@/domain/money';
import { PAGE_SIZE } from '@/constants/app';
import type { CashboxSummary, CashTransaction, CashTxType } from '@/types/models';
import { paths, toCashbox, toCashTransaction, type Actor } from './db';
import { AppError } from './errors';
import { auditFields, commitOfflineBatch, isOnline, requireOnline, runTx, type Writer } from './ops';
import type { Page } from './salesService';

export type CashMoveType = 'deposit' | 'expense' | 'withdrawal';

export interface CashMoveInput {
  type: CashMoveType;
  usdCents: number;
  lbp: number;
  category: string;
  note: string;
  rate: number;
}

/**
 * Records a manual drawer movement. Expenses and withdrawals may not exceed the drawer balance.
 * Works offline (atomic batch with increments, checked against the cached balance).
 */
export async function recordCashMove(actor: Actor, input: CashMoveInput, cachedCashbox: CashboxSummary): Promise<void> {
  const t = actor.tenantId;
  const usd = Math.max(0, Math.round(input.usdCents));
  const lbp = Math.max(0, Math.round(input.lbp));
  if (usd === 0 && lbp === 0) throw new AppError('error.invalidAmount');
  const sign = input.type === 'deposit' ? 1 : -1;

  const build = (w: Writer, cashbox: CashboxSummary, exact: boolean) => {
    if (sign < 0 && (usd > cashbox.usdCents || lbp > cashbox.lbp)) throw new AppError('error.drawerInsufficient');
    const audit = auditFields(actor);
    const ref = doc(paths.col(t, 'cashTransactions'));
    w.set(ref, {
      type: input.type,
      usdCents: sign * usd,
      lbp: sign * lbp,
      balanceAfter: exact ? { usdCents: cashbox.usdCents + sign * usd, lbp: cashbox.lbp + sign * lbp } : null,
      category: input.category.trim().slice(0, 60),
      note: input.note.trim().slice(0, 300),
      refId: null,
      refNumber: null,
      ...audit,
    });
    w.set(
      paths.cashbox(t),
      { usdCents: increment(sign * usd), lbp: increment(sign * lbp), lastTxId: ref.id, updatedAt: serverTimestamp() },
      { merge: true },
    );
    if (input.type === 'expense') {
      w.set(
        paths.doc(t, 'dailyStats', audit.localDate),
        {
          date: audit.localDate,
          expensesUsdCents: increment(usd + lbpToUsdCents(lbp, input.rate)),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
  };

  if (!isOnline()) {
    commitOfflineBatch((w) => build(w, cachedCashbox, false), `cash ${input.type}`);
    return;
  }
  await runTx(async (tx) => {
    const cashbox = toCashbox((await tx.get(paths.cashbox(t))).data());
    build(tx, cashbox, true);
  });
}

/** Sets the drawer to the counted amounts, recording the difference as an adjustment. */
export async function adjustDrawer(actor: Actor, counted: { usdCents: number; lbp: number }, note: string): Promise<void> {
  requireOnline();
  const t = actor.tenantId;
  await runTx(async (tx) => {
    const cashbox = toCashbox((await tx.get(paths.cashbox(t))).data());
    const targetUsd = Math.max(0, Math.round(counted.usdCents));
    const targetLbp = Math.max(0, Math.round(counted.lbp));
    const dUsd = targetUsd - cashbox.usdCents;
    const dLbp = targetLbp - cashbox.lbp;
    if (dUsd === 0 && dLbp === 0) throw new AppError('error.noChange');
    const ref = doc(paths.col(t, 'cashTransactions'));
    tx.set(ref, {
      type: 'adjustment',
      usdCents: dUsd,
      lbp: dLbp,
      balanceAfter: { usdCents: targetUsd, lbp: targetLbp },
      category: 'adjustment',
      note: note.trim().slice(0, 300),
      refId: null,
      refNumber: null,
      ...auditFields(actor),
    });
    tx.set(paths.cashbox(t), { usdCents: targetUsd, lbp: targetLbp, lastTxId: ref.id, updatedAt: serverTimestamp() }, { merge: true });
  });
}

export interface CashFilter {
  from: string;
  to: string;
  type: CashTxType | 'all';
}

export async function listCashTransactions(
  tenantId: string,
  filter: CashFilter,
  cursor: QueryDocumentSnapshot | null,
): Promise<Page<CashTransaction>> {
  const constraints: QueryConstraint[] = [where('localDate', '>=', filter.from), where('localDate', '<=', filter.to)];
  if (filter.type !== 'all') constraints.push(where('type', '==', filter.type));
  constraints.push(orderBy('localDate', 'desc'), orderBy('createdAtMs', 'desc'), limit(PAGE_SIZE));
  if (cursor) constraints.push(startAfter(cursor));
  const snap = await getDocs(query(paths.col(tenantId, 'cashTransactions'), ...constraints));
  return {
    items: snap.docs.map((d) => toCashTransaction(d.id, d.data())),
    cursor: snap.docs[snap.docs.length - 1] ?? null,
    hasMore: snap.docs.length === PAGE_SIZE,
  };
}

export async function loadCashRange(tenantId: string, from: string, to: string, type?: CashTxType): Promise<CashTransaction[]> {
  const constraints: QueryConstraint[] = [where('localDate', '>=', from), where('localDate', '<=', to)];
  if (type) constraints.push(where('type', '==', type));
  const snap = await getDocs(query(paths.col(tenantId, 'cashTransactions'), ...constraints, limit(5000)));
  return snap.docs.map((d) => toCashTransaction(d.id, d.data()));
}
