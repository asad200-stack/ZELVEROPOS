# ZELVERO POS — scale follow-up (8 Oct 2026)

This does not replace `2026-10-08-production-readiness.md`. That verdict stays RED / NO-GO.

All timings below are from the Firestore and Functions emulators on this PC (`demo-zelvero` only). They are not production, not a phone, and not a broadband page-load. Nothing here was deployed. Indexes in `firestore.indexes.json` were not deployed. Production `zelvoropos`, `techstore01`, and the old CATCH project were not used.

## Verdict

**RED. Ready to sell: NO.**

The POS screen no longer subscribes to the product or customer collections. The products, customers, suppliers, expiry, purchases, dashboard, and reports screens still do. A 50-cashier burst did not finish on the Functions emulator, and five of those calls became sales after the client had already been told they failed. At 100,000 products the emulator name search and barcode lookup missed the time budgets. Those are still blockers.

## 1. Code changes

Restored after a file sync deleted the earlier catalog pass:

- `src/domain/searchKey.ts` and its unit test. `nameKey` matches `normalizeSearch`. `phoneKey` keeps digits. `emailKey` is trimmed and lowercased. `prefixEnd` appends U+F8FF.
- `src/services/catalogQuery.ts`. Page size 48. Cursor is `startAfter` on the last document, never an offset. Browse orders by `name` then document id so older products without `nameKey` still list. Search is a `nameKey` prefix. Barcode is an equality query. Category is an equality query plus the same order. Customers and suppliers can be paged by name, name prefix, phone, email, recent `createdAtMs`, or debt.
- POS (`PosPage.tsx`, `ProductPicker.tsx`, `CustomerSelect.tsx`) uses those pages. A barcode Enter calls `findProductByBarcode` and does not scan the page in memory. Cart lines that are not on the current page are loaded with `in` queries of at most 10 ids. The selected customer is one `get`.
- `functions/src/pos/rollups.ts` is the summary helper (one `meta/inventory` doc and one `meta/balances` doc). It is not called from checkout, stock, customers, or suppliers in the current tree. Those call sites were removed by the sync and were not wired again.
- `tests/integration/account.test.ts` sends `Connection: close` on the public signup probe.
- `tests/integration/offline.test.ts` queues 100 offline sales, reopens the store, syncs, then a second device conflicts.
- Composite indexes for the POS queries were added to `firestore.indexes.json` and not deployed. Phone and email equality use Firestore's automatic single-field indexes.

Still on a full-collection listener when those screens are open: products, product form, product tools, expiry, purchases, customers, customer form, suppliers, sales customer filter, sale return form, dashboard, reports. `tenantStore` still has `products`, `customers`, and `suppliers`.

Listener tradeoff for the POS page: tiles can be briefly stale. Checkout re-reads stock and prices on the server. The page is one query, replaced when the search or category changes, not a stack of listeners.

## 2. Catalog before and after

Before, opening a screen that calls `useProducts`, `useCustomers`, or `useSuppliers` attaches `onSnapshot` to the whole collection.

After this pass, the POS does not. A first paint reads 48 products. A barcode read returns 0 or 1 document. A customer search reads one page. The other screens listed above are unchanged and still download the collection.

## 3. Product queries (emulator)

Documents read per query were 48, 48, 48, 1, and 10 (the prefix `item 00001` has ten matches). The 100,000-product catalog was not loaded into a UI.

| Products | First page | Second page | Category | Barcode | Name prefix | Full collection get |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 171 ms | 68 ms | 39 ms | 32 ms | 36 ms | 215 ms (1,000 docs) |
| 10,000 | 169 ms | 145 ms | 125 ms | 66 ms | 101 ms | 787 ms (10,000 docs) |
| 50,000 | 380 ms | 353 ms | 473 ms | 226 ms | 320 ms | not run |
| 100,000 | 942 ms | 902 ms | 972 ms | 745 ms | 1,168 ms | not run |

Heap during the 100,000-product queries was about 65–77 MB. RSS was about 169 MB. Writes of the 100,000 products, in batches of 500, were 3.3 s + 1.1 s + 2.4 s + 2.7 s for the four steps.

## 4. Sales queries (emulator)

Each history page returned 50 documents. The report query stopped at 5,000. The count did not download the documents.

| Sales | History page | Page 2 | Invoice | One customer's page | Report cap | Count |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 80 ms (50) | 100 ms | 64 ms (1) | 72 ms (10) | 273 ms (5,000) | 129 ms |
| 100,000 | 591 ms | 620 ms | 543 ms | 1,589 ms (50) | 1,151 ms | 1,032 ms |
| 1,000,000 | 7,711 ms | 9,204 ms | 7,150 ms | 14,083 ms | 11,285 ms | 10,463 ms (count = 1,000,000) |

The 900,000-document write that took the collection from 100,000 to 1,000,000 took 39,675 ms. The 1,000,000-sale queries were actually run. They are too slow on this emulator to call the history screen fine at that size. Customer purchase history in the app is the sales page filter (`customerId` + date + limit 50), not a download of the tenant's sales. No customer screen loads the sales collection.

## 5. Customers and suppliers (emulator)

| Collection | Size | First page | Second page | Name prefix | Phone | Debtors page | Recent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Customers | 1,000 | 33 ms | 49 ms | 33 ms | 24 ms | 56 ms | 49 ms |
| Customers | 10,000 | 144 ms | 152 ms | 119 ms | 111 ms | 168 ms | 83 ms |
| Customers | 50,000 | 399 ms | 335 ms | 283 ms | 219 ms | 425 ms | 199 ms |
| Suppliers | 1,000 | 31 ms | 47 ms | 36 ms | 25 ms | — | — |
| Suppliers | 10,000 | 75 ms | 86 ms | 61 ms | 67 ms | — | — |

Each page returned 48 documents except the prefix (10) and the phone lookup (1).

## 6. Integration

`npm run test:integration` at 14:06 local: **3 files, 65 tests, 0 failed, 62.86 s**. That run included the empty-drawer cases and the signup burst with `Connection: close`.

The suite was not run again after the file sync. Unit tests after the restore: **22 files, 174 tests, 0 failed**.

## 7. Signup burst

The function `checkSignupAvailability` reads one subdomain document and has no rate limit. A single warm call took 30 ms.

Fifteen parallel `fetch` calls with the default keep-alive took **8,241 ms**. The emulator reloaded its worker and ran them mostly one after another. The same fifteen calls with `Connection: close` all started together and finished in **521 ms**, with one identical body. The earlier 60-second timeout was that emulator queue, not a product limiter and not a wrong assertion. The test still requires all fifteen responses for a subdomain to be identical. The timeout was not raised.

## 8. Empty drawer

Unchanged and still covered by the unit test and by the integration file that passed at 14:06. Due $501, received $555, drawer $0 and 0 LBP, rate 89,500: $54 USD change is allowed because the tender contains it. 3,040,000 LBP change is refused because neither the drawer nor the tender has LBP. The server rejects a result that would make either currency negative. It does not reject USD change merely because the drawer was empty before the tender.

## 9. Concurrency (emulator, one Node worker)

`Connection: close` was used so the keep-alive queue from section 7 was not the thing being measured. Each different-product sale was $5 cash.

| Case | Result |
| --- | --- |
| 5 different products | 5 created, 5 invoices, drawer +$25.00, counter +5 |
| 20 different products | 20 created, 20 invoices, drawer +$100.00, counter +20 |
| 50 different products | **Not completed.** 1 acknowledged, 47 `INTERNAL`, 2 aborted at 45 s. Wall time 45 s |
| 5 debt payments of $1 on a $5 debt | Debt ended at $0. Drawer +$5.00 |
| Stock 10, remove 4, plus 5 sales of 1 | Stock ended at 1. Six movements |
| 5 returns of $5 | Stock +5. Drawer −$25.00 |

The 50-user run is not a pass. After every later scenario, the sale count was 62 and the counter's next id was 68. Acknowledged sales plus the five returns account for 57 sales and a next id of 63. The extra five sales and five counter steps match five of the `INTERNAL` calls committing after the client had already failed. Each of those sale ids was unique, so this was not a double write of one id. A cashier who pays again with a new id would sell twice. That was the Functions emulator, not Cloud Run, and it is still a failed 50-user run.

## 10. Same product, stock 10

| Buyers | Created | `insufficientStock` | Stock after | Drawer | Movements |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 5 | 0 | 5 | +$25.00 | 5 |
| 10 | 10 | 0 | 0 | +$50.00 | 10 |
| 20 | 10 | 10 | 0 | +$50.00 | 10 |

Stock did not go negative. Success count matched the stock. Failures were the stock conflict.

## 11. Idempotency

Twenty concurrent checkouts with one `saleId`: **1 sale, 1 movement, stock 10→9, drawer +$5.00, invoice INV-052.** Nineteen callers got `error.alreadyExists`, not `{ duplicate: true }`. A later retry of an existing sale still returns `duplicate: true` (the integration test that passed at 14:06). Concurrent first attempts collide with already-exists. They did not sell twice.

## 12. Invoice counter

After the 5-user and 20-user runs and the one acknowledged 50-user sale, invoices were `INV-001` through `INV-026`: 26 unique, no gaps. The final next id (68) equals final sales (62) + returns (5) + the starting value 1. The five late commits from section 9 are inside that total. No duplicate invoice was observed in the checkpoint.

## 13. Long offline

One hundred cash sales were queued in IndexedDB, the store was closed and reopened, then synced. **The test passed** (file duration 23.57 s, 17 other tests in that file skipped). Stock went from 100 to 0. The drawer gained $500.00. Invoice numbers were consecutive in queue order. A second emulator client then sold one more unit and got `OUT_OF_STOCK`. The drawer did not move for that conflict.

The same file's earlier tests, which passed inside the 65, already cover a lost response, two tabs, price change, archived product, deleted product, rate change, IMEI, credit limit, deactivated user, and expired subscription. This was not a wall-clock multi-hour soak. The exact sync-only millisecond figure was not captured; the whole test file finished in 23.57 s.

## 14. Two devices

The 100-sale test's second client is two emulator clients on `demo-zelvero`. The integration test "two offline devices compete for the last unit" also passed in the 65. Two Chrome profiles against the production TEST tenant were not used.

## 15. Performance budget

Not met, and not measured in a browser.

| Budget | Emulator result |
| --- | --- |
| First product page under 1 s | Met through 100,000 products (942 ms). This is the query only, after the data was already written |
| Barcode under 500 ms | Met at 50,000 (226 ms). **Missed at 100,000 (745 ms)** |
| Category under 1 s | Met at 100,000 (972 ms) |
| Name search under 1 s | Met at 50,000 (320 ms). **Missed at 100,000 (1,168 ms)** |
| POS interactive under 2 s after auth | **Not measured** |
| Low-end phone | **Not measured** |

Sales history at 1,000,000 documents took 7.7 s for 50 rows on this emulator.

## 16. Firestore cost comparison

Read counts, not a bill. Firestore bills one read per document returned, and one read for an empty query. Assumption for the dollar line only: the public list price of $0.06 per 100,000 reads. This is not a measured invoice.

| Action | Old listener | Paged POS |
| --- | ---: | ---: |
| Open POS on a 100,000-product catalog | 100,000 product reads, plus every customer and supplier if those listeners are mounted | 48 product reads |
| Barcode | scans the in-memory copy | 1 read |
| Next page | already downloaded | 48 reads |

Illustration, not a forecast: 20 cashiers open the POS 10 times a day for 30 days on a 100,000-product catalog. Old shape: 600,000,000 product reads, about $360 at the list price above. Paged shape: 288,000 reads, about $0.17. Listeners also bill later updates to every open screen. That volume was not measured. The products and reports screens still use the old shape, so this saving applies only when those screens are not open.

## 17. Security gaps still open

- App Check is not enforced. Callable logs still say `app: MISSING`. Do not turn it on in this stage.
- Clients may still edit product, customer, and supplier documents, including stock fields the rules already freeze. Money and stock writes from the client stay denied.
- Cash moves have no client idempotency key.
- A lost checkout response under emulator load can commit the sale anyway (section 9). Retry must reuse `saleId`.
- Signup availability still reveals whether a subdomain exists. It does not reveal whether an email exists.

## 18. Operational gaps still open

- The non-POS screens still download master data.
- Summary documents are not updated, because the rollup helper is not called. Existing stores have no backfill. A report that summed the listener is still doing that.
- Composite indexes are not deployed. The paged POS queries need them in production.
- Business date on the server uses `Asia/Beirut` unless configured. The client uses the machine calendar.
- 50 concurrent checkouts are not reliable on the Functions emulator.
- Low-stock on the dashboard, where it still uses the listener, is the whole catalog. The bounded query that was drafted (store threshold, limit 8) is not what the reverted dashboard runs.
- Nothing in this pass was deployed.

## 19. Currency proposal (not implemented)

Keep USD integer cents and LBP whole pounds for Lebanon, rate 89,500, and the current drawer fields.

A later design, if a tenant needs another currency:

- One tenant base currency, ISO 4217, with an explicit minor-unit exponent (USD 2, LBP 0, KWD 3).
- Amounts stored as integers in that minor unit. No floats.
- Extra currencies are priced only through an exchange-rate pair (base per 1 foreign, or foreign per 1 base) with a timestamp and a version. Checkout refuses a stale version, as it already refuses a stale USD/LBP rate.
- The drawer stays one balance per currency that was physically received. A rate converts a display total. It does not fund change in a currency the drawer and the tender do not hold.
- Formatting uses the tenant locale. It does not change storage.

Do not rewrite the current USD/LBP money path to get there.

## 20. RED / YELLOW / GREEN

**RED.**

GREEN would need no full-catalog listener on the normal screens, a current integration run at 0 failed, the scale tests executed (they were), concurrency without a lost commit, the long offline test (it passed), and no financial failure. The 50-user lost commits and the remaining full-catalog listeners are still failures. Passing unit tests do not change that.

## 21. Ready to sell

**NO.**
