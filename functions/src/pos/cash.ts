import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { fail } from '../errors.js';
import { lbpToUsdCents } from '../shared/money.js';
import { caller, parse } from '../validate.js';
import {
  auditFields,
  bumpDailyStats,
  cents,
  exchangeRateOf,
  idField,
  lbpField,
  noteField,
  runClientOp,
  tenantPaths,
  toCashbox,
} from './common.js';

const moveSchema = z.object({
  clientOperationId: idField,
  type: z.enum(['deposit', 'expense', 'withdrawal']),
  usdCents: cents,
  lbp: lbpField,
  category: z.string().trim().max(60).default(''),
  note: noteField,
});

/** Manual drawer movement. Expenses and withdrawals may not exceed the drawer balance. */
export const posCashMove = onCall(async (request) => {
  caller(request);
  const input = parse(moveSchema, request.data);
  if (input.usdCents === 0 && input.lbp === 0) fail('invalid-argument', 'error.invalidAmount');
  return runClientOp(request, input.clientOperationId, 'posCashMove', ['canManageCashDrawer'], async (tx, actor) => {
    const t = actor.tenantId;
    const p = tenantPaths(t);
    const atMs = Date.now();
    const sign = input.type === 'deposit' ? 1 : -1;
    const [cashSnap, settingsSnap] = await Promise.all([tx.get(p.cashbox), tx.get(p.settings)]);
    const cashbox = toCashbox(cashSnap.data());
    if (sign < 0 && (input.usdCents > cashbox.usdCents || input.lbp > cashbox.lbp)) fail('failed-precondition', 'error.drawerInsufficient');
    const audit = auditFields(actor, atMs);
    const ref = p.newRef('cashTransactions');
    const after = { usdCents: cashbox.usdCents + sign * input.usdCents, lbp: cashbox.lbp + sign * input.lbp };
    tx.set(ref, {
      type: input.type,
      usdCents: sign * input.usdCents,
      lbp: sign * input.lbp,
      balanceAfter: after,
      category: input.category,
      note: input.note,
      refId: null,
      refNumber: null,
      ...audit,
    });
    tx.set(p.cashbox, { ...after, lastTxId: ref.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (input.type === 'expense') {
      const rate = exchangeRateOf(settingsSnap.data());
      bumpDailyStats(tx, t, audit.localDate, { expensesUsdCents: input.usdCents + lbpToUsdCents(input.lbp, rate) });
    }
    return { ok: true, cashTxId: ref.id };
  });
});

const adjustSchema = z.object({
  clientOperationId: idField,
  usdCents: cents,
  lbp: lbpField,
  note: noteField,
});

/** Owner-only: sets the drawer to the counted amounts, recording the difference as an adjustment. */
export const posAdjustDrawer = onCall(async (request) => {
  const input = parse(adjustSchema, request.data);
  return runClientOp(
    request,
    input.clientOperationId,
    'posAdjustDrawer',
    [],
    async (tx, actor) => {
      const p = tenantPaths(actor.tenantId);
      const atMs = Date.now();
      const cashbox = toCashbox((await tx.get(p.cashbox)).data());
      const dUsd = input.usdCents - cashbox.usdCents;
      const dLbp = input.lbp - cashbox.lbp;
      if (dUsd === 0 && dLbp === 0) fail('failed-precondition', 'error.noChange');
      const ref = p.newRef('cashTransactions');
      const after = { usdCents: input.usdCents, lbp: input.lbp };
      tx.set(ref, {
        type: 'adjustment',
        usdCents: dUsd,
        lbp: dLbp,
        balanceAfter: after,
        category: 'adjustment',
        note: input.note,
        refId: null,
        refNumber: null,
        ...auditFields(actor, atMs),
      });
      tx.set(p.cashbox, { ...after, lastTxId: ref.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { ok: true, cashTxId: ref.id };
    },
    (actor) => {
      if (!actor.isOwner) fail('permission-denied', 'error.fn.notOwner');
    },
  );
});
