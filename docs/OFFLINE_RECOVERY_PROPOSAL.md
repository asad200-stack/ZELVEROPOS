# Proposal: owner recovery of stranded offline sales

Status: **proposal for review — not implemented.**

## Problem

A cashier takes cash while offline. The sale is queued in that device's IndexedDB under the
cashier's `uid` and `tenantId`. Phase 3 isolation guarantees that only the same cashier, signed in on
the same device, can see or send it. If that cashier never signs in on that device again, the sale
never reaches the server: the cash is physically in the store but missing from the drawer, stock and
reports, and the owner has no way to know.

## Constraints (unchanged from Phase 3)

- Another user's session must never display, edit or silently send a cashier's queued operation.
- Local data never grants permissions; every decision is re-checked by the server.
- A sale is booked at most once (the queue id is the sale document id).
- No queue payloads (items, customers, amounts per line) are uploaded outside the normal sync.

## Proposed design

### 1. Detection: device pending summary (metadata only)

- Each browser profile gets a random `deviceId` stored in the `meta` store of `zelvero-offline`,
  plus an optional label set by the owner ("Front counter").
- Whenever **any** user of the tenant is signed in and online, the app calls a new callable
  `posReportDevicePending` with counts only, grouped by `uid`:
  `{ deviceId, label, entries: [{ uid, pending, oldestCreatedAtMs, cashUsdCents }] }`.
  No item lines, no customers, no offline references of other users.
- The server keeps `tenants/{t}/devices/{deviceId}` (`lastSeenAtMs`, `reportedBy`, entries), ignores
  entries whose `uid` is not a member of the caller's tenant, and only owners (or a new
  `canRecoverOffline` permission) can read the collection.
- The dashboard shows a warning such as: *"Front counter: 2 unsynced sales by Cashier One, $15.00
  cash, oldest 3 days"*. A device that held pending sales and has not reported for N days is flagged
  as well.

This reveals to the owner only that work is stranded, where, by whom and how much cash is involved,
which the owner is already entitled to know.

### 2. Recovery: explicit, on the device, by the owner

Data exists only on that device, so recovery requires physical access. Remote submission is
deliberately impossible.

1. The owner signs in on the device. The app (online only, server-verified owner claims) shows
   *"Pending sales left by other users on this device"* with each sale's reference, time, cashier,
   total and cash.
2. The owner selects sales and confirms in a dialog that states the cashier, the totals and that the
   owner is vouching for them. Nothing is sent without this confirmation.
3. The app calls a new callable `posRecoverOfflineSale(operation)`:
   - requires owner (or `canRecoverOffline`) and `operation.tenantId === caller tenant`;
   - requires the original cashier to be a member of the tenant;
   - runs the same checkout transaction as `posCheckout`, with the **same sale id** (queue id);
   - records `createdBy = original cashier`, `recoveredBy = owner`, `recoveredAtMs`, and writes an
     audit entry;
   - is idempotent: an existing sale with that id is returned instead of being written again.
4. The local record is marked `SYNCED` with the official invoice number. The original cashier's next
   sign-in sees it as synced.
5. The owner may instead **void** a stranded sale (for example, the cash was never actually taken).
   Voiding is audited on the server (reference, amount, cashier, reason) and only then removed locally.

### 3. Why duplicates stay impossible

- The sale id is the queue id, and checkout runs in a transaction that first reads that id.
- Today `posCheckout` returns the existing sale to the same `createdBy` and rejects other callers
  with `already-exists`. Because recovery stores the original cashier as `createdBy`, a later
  retry by that cashier is answered as a duplicate (`SYNCED`, same invoice), not as a second sale.
- A cashier's normal sync and an owner recovery racing each other both target the same document id;
  the transaction guarantees only one write.

### 4. What other cashiers can and cannot do

- Cashier 2 on the same device: contributes anonymous counts to the device summary; cannot see,
  send, recover or void Cashier 1's sales (unchanged).
- Owner on another device: sees the summary and the warning; cannot recover until on the device.

## Out of scope / rejected options

- Uploading full queued operations to Firestore for remote recovery: turns local queues into a
  second, weakly controlled write path.
- Letting any signed-in user flush the whole device queue: breaks isolation and attribution.
- Encrypted per-user export files: possible later, adds key management.

## Work estimate

One callable for summaries, one for recovery and voiding, rules for `devices`, a dashboard warning
and a recovery screen, plus integration tests (recovery idempotency, cross-tenant rejection,
non-owner rejection, a race between recovery and the cashier's own sync).
