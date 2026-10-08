# ZELVERO POS
# Complete system audit and production-readiness report

Date: 8 October 2026  
Auditor environment: local Windows workstation, Firebase emulators, project id `demo-zelvero` only  
Production project `zelvoropos` was not written to. The live store `techstore01` was not used.

## 1. Executive summary

Zelvero POS has a real server-authoritative money and stock core, tenant isolation rules that passed, and a checkout path that keeps USD and LBP separate. That is not the same as being ready to sell as a global platform.

This audit ran the unit suite, the security-rules suite, the integration suite, a header layout measurement, and a Firestore emulator read of 1,000 and 10,000 products. It did not run 50,000 or 100,000 products, 1,000,000 sales, multi-hour offline sessions, or 5, 20, or 50 concurrent users. Those items are marked **NOT TESTED**. No benchmark below was estimated and then presented as a measurement.

**Verdict: RED — not ready for commercial release.**

The financial core that was tested is in better shape than the scale story. The product, customer, and supplier screens subscribe to the entire collection. A full read of 10,000 product documents took 11.2 seconds on the local emulator. Selling this as a system for large catalogs and years of history would be premature.

## 2. Cashbox header (completed in this pass)

The Cashbox chip is no longer placed beside the connection status. On the Point of Sale page the header is three columns: store name on the left, the chip in the center, and status, exchange rate, language, and theme on the right.

Measured in headless Chrome against the layout fixture, chip center minus header center:

| Viewport | Direction | Offset | Header height | Page overflow |
| --- | --- | --- | --- | --- |
| 1440×900 | LTR | 0 px | 56 px | no |
| 1280×720 | LTR | 0 px | 56 px | no |
| 390×844 | LTR | 0 px | 83 px (chip on its own centered row) | no |
| 1366×768 | RTL | 0 px | 56 px | no |

Cash In and Cash Out still call the existing drawer movement. There is still no Transfer action. The store has one cash drawer. A transfer needs a second drawer, and adding one would be a new accounting system. That action was not invented.

The chip reads the same `cashbox/summary` document as the Cash Drawer page.

## 3. What was actually executed

| Suite | Environment | Result |
| --- | --- | --- |
| Unit tests (`npx vitest run`) | Node, no Firebase | **PASS** — 21 files, 172 tests, 8 Oct 2026 11:07 |
| Firestore and Storage rules | Emulators, `demo-zelvero` | **PASS** — 2 files, 44 tests, about 17 s of test time |
| Cloud Functions integration | Emulators, `demo-zelvero`, JDK 25 | **PARTIAL** — 64 passed, 1 failed |
| Emulator catalog read | Firestore emulator only | **PASS for 1,000 and 10,000 products**. Larger sizes not run |
| Header geometry | Headless Chrome, local fixture | **PASS** — center offset 0 px |
| End-to-end browser suite | Not started this session | **NOT TESTED** |
| 50,000 / 100,000 products | Not started | **NOT TESTED** |
| 10,000 / 100,000 / 1,000,000 sales | Not started | **NOT TESTED** |
| 5 / 20 / 50 concurrent users | Not started | **NOT TESTED** |
| Multi-hour offline session | Not started | **NOT TESTED** |
| Two physical devices | Not started | **NOT TESTED** |
| Production billing export | Not available | **NOT TESTED** |

The integration failure was `tests/integration/account.test.ts`: “a burst of probes yields one response per subdomain”. It hit the 60 second test timeout. It did not fail a financial assertion. The POS integration file, which includes the empty-drawer change cases added in this pass, was in the passing set. The signup burst was not re-run, so it stays a fail for this audit.

Emulator function log samples from that same run (not production latency): several `posCheckout` calls finished in 4.9 ms, 7.9 ms, and 6.1 ms; one checkout that also ran the sale trigger finished in 219 ms. These are single-call emulator times, not a load test.

## 4. Database performance results

Environment: Firestore emulator at `127.0.0.1:8080`, project `demo-zelvero`, one Node process using `firebase-admin`. Documents were small product stubs (name, barcode, category, stock, one price). This is not production Firestore and not the browser.

| Dataset | Writes | Full collection read | `orderBy(name).limit(50)` | Heap after the read |
| --- | --- | --- | --- | --- |
| 1,000 products | 16.8 s for those 1,000 | 2,840 ms, 1,000 docs | 232 ms, 50 docs | 26 MB |
| Next 9,000 products (collection then held 10,000) | 15.6 s | 11,183 ms, 10,000 docs | 344 ms, 50 docs | 36 MB |

A page of 50 stayed under 0.4 s. Reading the whole collection did not. The POS product list does the whole-collection pattern: `onSnapshot` on `tenants/{id}/products` with no limit (`src/stores/tenantStore.ts`). The grid then shows at most 80 matches in memory. Customers and suppliers use the same unbounded listener.

Sales, cash transactions, stock movements, and the customer ledger are paged (`PAGE_SIZE` is 50) and have composite indexes. Daily report totals read `dailyStats` with a limit of 1,000 days. Owner backup downloads each backup collection with a limit of 50,000 documents.

50,000 products, 100,000 products, and 1,000,000 sales were not loaded. No error rate or production memory figure is claimed for them.

## 5. Database scalability assessment

**PARTIAL, and not acceptable for the stated target.**

Paged history can grow without loading every sale into the browser. The master catalogs cannot. A shop with a few hundred products will not notice. A shop with tens of thousands will download and keep that catalog on every connected POS screen. That is the main scale defect found in code and confirmed by the 10,000-document read.

There is no virtualized product grid. Search filters the in-memory array.

Cloud Functions are pinned to `europe-west1` with `maxInstances: 20`. That cap protects cost and also caps simultaneous checkouts. It was not load-tested.

## 6. Online reliability

**PARTIAL.**

Integration tests on the emulator recorded a cash sale, stock movement, drawer net, invoice counter, and daily stats in one transaction, and rejected a second full return. Those tests passed in this run.

Not tested live this session: a cashier completing a sale on the hosted app, a report refreshed after that sale, or a customer balance after a credit sale in a browser. The code path is the same callable the integration suite calls. A browser pass was not repeated here.

## 7. Offline reliability

**PARTIAL. The dangerous cases that were automated passed as unit tests. A long disconnected session was not run.**

`src/offline/offline.test.ts` is part of the 172 passing unit tests. It covers a lost response retried twice producing one sale because the server answers `duplicate: true` for the same `saleId`. Failed queue records are not pruned. That is unit-level evidence, not a multi-hour test.

Checkout is idempotent on `saleId` in `posCheckout`. Cash In and Cash Out do not have their own idempotency key. A double click is blocked in the dialog while the request is in flight. Two separate requests still create two movements. That matches the Cash Drawer page.

Disconnect-during-checkout, hours offline, and two devices were **NOT TESTED** on real hardware this session.

## 8. Financial accuracy

**PASS for the cases that have automated tests. Not a full ledger replay.**

USD is integer cents. LBP is whole pounds. The rate used in tests is 89,500.

The screenshot case is now a unit test, and that test passed:

- Due $501.00 (50,100 cents), due LBP 44,839,500, rate 89,500.
- Received $555.00, drawer USD 0, drawer LBP 0.
- Automatic change is $54.00 and 0 LBP. That is allowed, because the $555 just received covers the $54.
- A return of 3,040,000 LBP is rejected. Nothing in the drawer or the payment can fund those pounds.

The server no longer rejects change merely because the drawer was empty before the tender. It still rejects a result that would make either currency negative. That check is in the checkout transaction (`after.usdCents < 0 || after.lbp < 0`).

Credit sales do not add the unpaid amount to the drawer. The integration suite covers a credit sale, a later cash payment, and a return. Those tests were in the passing integration file.

Not re-measured this session as a fresh browser walk-through: every report line, every expense category, and a full year of daily stats. The formulas live in shared domain code and are what the functions execute after `copy-shared`.

Transfer between cashboxes: **not implemented**. One drawer per store.

Historical rate: a sale stores the rate, and checkout rejects a rate that no longer matches settings (`error.rateChanged`). That test is in the integration file and the file passed.

## 9. Security findings

| Finding | Severity | Evidence | Status |
| --- | --- | --- | --- |
| Clients cannot write sales, stock movements, the drawer, cash transactions, or ledgers | — | `firestore.rules` `allow write: if false` on those paths. Rules suite 44/44 passed, including tenant isolation | Holds in the emulator |
| Checkout re-reads prices, stock, rate, and the drawer inside a transaction | — | `functions/src/pos/sales.ts` | Code plus integration tests |
| Another tenant cannot read this tenant | — | Rules test “another tenant owner cannot read or write this tenant” in the passing suite | Emulator |
| App Check is not enforced | P1 | Callable logs in this run say `"app":"MISSING"` and the call still succeeds. The client only starts App Check when a site key is configured | Open. Do not turn it on blindly; it was deliberately left off until a separate stage |
| No application-level rate limit on checkout | P2 | Not found on `posCheckout`. Signup probes exist and one of those tests timed out | Open |
| Cash movements have no idempotency key | P2 | `posCashMove` always allocates a new transaction id | Open |
| Backup can read up to 50,000 documents per collection for a privileged user | P2 | `settingsService.ts` `limit(50_000)` | By design for export, costly if catalogs grow |
| Secrets in git | Not re-audited file by file this session | Prior project rule: secrets stay server-side | Not re-proven here |

Manipulated production requests were not sent. The rules and function tests are the manipulation tests, and they ran against `demo-zelvero`.

## 10. Firebase architecture

One Firestore database, data under `tenants/{tenantId}`. Identity is custom claims written by Cloud Functions. Owners bypass the permission map. Sub-users need an explicit permission. Subscription expiry makes the client read-only through rules (`subUntil`).

Money writes go through callables, not client updates. That split is the right one for a POS and does not need a rewrite to add features. What will get expensive is the unbounded catalog listeners and the backup scan, not the sale document shape.

Region is `europe-west1`. A store far from that region will pay that latency on every checkout. There is no multi-region deployment.

## 11. UI and direction

English sets `dir=ltr` on the document. Arabic sets `dir=rtl`. Numeric inputs use `dir="ltr"` through the shared field component and a stylesheet rule. Displayed money is wrapped so the digits stay in mathematical order inside Arabic sentences.

Measured on an Arabic page in headless Chrome earlier in this work: a decimal field’s computed direction was `ltr`, an Arabic note stayed `rtl`, and typing `555.00` and a barcode did not reverse. This audit did not repeat a full Arabic click-through of every page.

The header change did not add a new POS row on desktop (header stayed 56 px). Phone width puts the chip on a second centered row (83 px).

## 12. Mobile compatibility

**PARTIAL.** The layout fixture was measured at 390 px wide: no page overflow, chip centered. A real phone, a tablet, and a low-power device were **NOT TESTED**.

## 13. Performance benchmarks that exist

- Unit suite: about 1.6 s.
- Rules suite: about 17 s of tests, plus emulator startup.
- Integration suite: about 217 s of tests. One test timed out at 60 s.
- Emulator catalog: numbers in section 4.
- Single emulator checkouts: about 5–8 ms for the short calls logged, 219 ms for one call that also ran the sale trigger.

No dashboard load time, no barcode scan time, and no long-session memory leak test were recorded.

## 14. Infrastructure cost

**NOT TESTED against a billing account.** No dollar figure is stated. The cost driver that is visible in code is unbounded catalog listeners: every open POS keeps a listener on every product, customer, and supplier. Reads scale with catalog size times connected clients, not with the 80 products on screen. Paged sales do not have that problem.

## 15. International scalability

The data model can hold many tenants. It cannot, today, hold an arbitrary set of currencies. Money is USD cents plus LBP integers and one store rate. Dates on the server use `BUSINESS_TIMEZONE`, default `Asia/Beirut`. The browser date helper uses the machine’s local calendar. A cashier whose laptop is not in the store timezone can label a business day differently from the server. That was read from code, not reproduced on two clocks.

Locale support that exists is English and Arabic. There is no third language and no per-country tax engine.

A rewrite is not required to add pagination, a store timezone on the client, or more currencies. A rewrite would be required if catalogs stay fully mirrored to every browser and the product then promises 100,000 SKUs.

## 16. Missing or incomplete features

- Transfer between drawers. Not built. One drawer.
- App Check enforcement. Not on.
- Catalog pagination and virtualization. Not built.
- Concurrent-user proof. Not tested.
- Million-row history proof. Not tested.
- This session’s browser end-to-end suite. Not run.

## 17. Problems

**P0 — none newly proven in this run.** No test showed a sale that both committed and corrupted stock or the drawer. The empty-drawer change bug was fixed before this report and covered by the new unit test. It is in the working tree, not deployed.

**P1**

- Entire product, customer, and supplier collections are live-subscribed. Measured full reads: 2.8 s at 1,000 docs, 11.2 s at 10,000 docs, on the emulator.
- Essential scale, concurrency, and long-offline tests were not run. Commercial scale is unproven.
- App Check is not enforced, so callables accept authenticated traffic without an app attestation.

**P2**

- Cash In / Cash Out are not idempotent on the server.
- Signup availability burst test timed out once.
- Client business dates follow the browser timezone; the server defaults to Beirut.
- Backup stops at 50,000 documents per collection with no warning in the measurement set.

**P3**

- Cashbox label is “Cashbox” plus “USD” and “LBP”. The LBP figure no longer repeats the word LBP.

## 18. Roadmap

1. Paginate or index-search products, customers, and suppliers. Stop mirroring the whole catalog into every POS. Retest at 10,000 and then 50,000 before claiming those sizes.
2. Deploy the drawer change fix only after a human checks the POS on a non-production store.
3. Add an idempotency key to cash movements.
4. Plan App Check as its own stage. Do not flip it on inside this audit.
5. Run a real two-browser stock race and a scripted 20-checkout burst on the emulator, then publish those numbers.
6. Only after that, consider a second currency or a second drawer. Neither exists now.

## 19. Production-readiness checklist

| Check | Result |
| --- | --- |
| Server checks prices, stock, rate, and drawer | Yes, in code and integration tests |
| Client cannot write the drawer | Yes, rules tests |
| Tenant isolation | Yes, rules tests |
| Empty-drawer USD change from the tender | Yes, unit test. Server path updated. Not deployed |
| LBP change without LBP on hand | Rejected, unit test |
| 10,000 product full read | Measured, too slow to repeat on every screen |
| 100,000 products / 1,000,000 sales | Not tested |
| Concurrent cashiers | Not tested |
| Hours offline | Not tested |
| App Check | Not enforced |
| Ready to sell | No |

## 20. Answers and verdict

1. **Is Zelvero POS ready to be sold today?** No.
2. **Are the critical financial calculations reliable?** The cases covered by unit and integration tests are. A full historical replay was not done. The empty-drawer change rule is fixed in this tree and not deployed.
3. **Is offline operation safe?** The automated idempotency tests passed. A long real disconnection was not run, so it is not proven dependable.
4. **Can the database handle years of transactions?** Sales are paged, which can. Catalog listeners cannot, once catalogs leave the small-shop range. Years of sales were not loaded.
5. **Is customer data protected?** Emulator rules stop cross-tenant reads and client writes of ledgers. App Check is off. Production penetration testing was not done.
6. **Can multiple employees work at once without corruption?** Checkout is a transaction, which is the right mechanism. A concurrent test was not run.
7. **Is the UI professional enough?** The current POS is coherent and the header chip is centered. That is not a commercial sign-off. A full Arabic and low-end device pass was not done this session.
8. **What must be fixed before launch?** Catalog loading, a deployed verification of the change fix, and the missing scale tests. App Check needs a planned rollout, not a surprise switch.
9. **What can wait?** A second drawer and Transfer. More languages. Visual polish beyond the centered chip.
10. **Is the architecture suitable for international expansion?** The tenant boundary is. The currency model and the full-catalog listeners are not, without further work.

**RED — not ready for commercial release.**

The objective is a system businesses can trust every day. The money path is real and mostly tested. The scale path is not. Shipping on the strength of a running screen would ignore measurements this audit actually took.
