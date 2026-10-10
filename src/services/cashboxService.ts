import {
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { PAGE_SIZE } from '@/constants/app';
import type { CashTransaction, CashTxType } from '@/types/models';
import { paths, toCashTransaction } from './db';
import { newClientOperationId, retryOnTransport } from './clientOperation';
import { AppError } from './errors';
import { posApi } from './functionsClient';
import { requireOnline } from './ops';
import type { Page } from './salesService';

export type CashMoveType = 'deposit' | 'expense' | 'withdrawal';

export interface CashMoveInput {
  type: CashMoveType;
  usdCents: number;
  lbp: number;
  category: string;
  note: string;
}

/** Records a manual drawer movement (server-side; expenses/withdrawals may not exceed the drawer). */
export async function recordCashMove(input: CashMoveInput): Promise<void> {
  requireOnline();
  const usdCents = Math.max(0, Math.round(input.usdCents));
  const lbp = Math.max(0, Math.round(input.lbp));
  if (usdCents === 0 && lbp === 0) throw new AppError('error.invalidAmount');
  const clientOperationId = newClientOperationId();
  await retryOnTransport(() =>
    posApi.cashMove({
      clientOperationId,
      type: input.type,
      usdCents,
      lbp,
      category: input.category.trim().slice(0, 60),
      note: input.note.trim().slice(0, 300),
    }),
  );
}

/** Owner-only: sets the drawer to the counted amounts, recording the difference as an adjustment. */
export async function adjustDrawer(counted: { usdCents: number; lbp: number }, note: string): Promise<void> {
  requireOnline();
  const clientOperationId = newClientOperationId();
  await retryOnTransport(() =>
    posApi.adjustDrawer({
      clientOperationId,
      usdCents: Math.max(0, Math.round(counted.usdCents)),
      lbp: Math.max(0, Math.round(counted.lbp)),
      note: note.trim().slice(0, 300),
    }),
  );
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

