# Legacy CATCH POS — Pre-migration audit

Audit of the original source (git tag `legacy-baseline`) performed before the ZELVERO POS rebuild.
Line numbers refer to files under `legacy/`.

## 1. Current architecture

A single-page app made of one HTML shell and a few very large global scripts:

| File | Size | Role |
|---|---|---|
| `public/script.js` | 38,380 lines / 1.8 MB | Almost all business logic, UI rendering, sync engine, translations |
| `public/styles.css` | 29,817 lines / 738 KB | Styles from many layered redesigns, heavy `!important` |
| `public/index.html` | 4,166 lines | 12 pages + ~34 modals, 52 inline handlers |
| `public/super-admin.js` | 2,263 lines | Super Admin dashboard (lazy loaded) |
| `public/firebase-*.js` | ~2,100 lines | Firebase compat SDK wrappers |
| `functions/index.js` | 3,727 lines | 33 Cloud Functions (v1 API) |

Data is **local-first**: every entity lives in the browser (sql.js SQLite + IndexedDB + OPFS + localStorage)
and a custom queue (`enqueueSyncOp` / `flushSyncQueue`) pushes documents to Firestore under
`userData/{ownerUid}/{collection}`. Totals, stock, debts and the cash drawer are computed in the browser.

## 2. Technologies

Vanilla ES2020 JavaScript, Firebase **compat** SDK 10.7.1 from CDN, sql.js 1.10 (WASM), JSZip, JsBarcode,
Chart.js (unpinned CDN), Font Awesome, Cairo font, service worker, Node 22 Cloud Functions (firebase-functions v1),
optional Electron/Tauri license hooks and a Vercel Telegram proxy.

## 3. Firebase services used

Authentication (email/password + email-link verification), Cloud Firestore (with offline cache),
Cloud Storage (product images `products/{ownerUid}/...`), Cloud Functions (callable + HTTP + 2 hourly
schedulers), Hosting (two sites: prod + test). No App Check, no emulator configuration for the app.

## 4. Firebase project references (all removed from the new app)

Project `pos-catch` (number `891436013106`), hosting sites `pos-catch` and `pos-catch-test`.
Hard-coded in: `public/firebase-config.js` (full web config), `public/firebase-db.js:41`,
`public/script.js:9616-9617, 28855` (function URLs), `public/super-admin.js:1046, 1234-1315`,
`public/app-environment.js`, `public/LICENSE_PROTECTION.js:7`, `public/index.html:552`,
`functions/index.js:140, 228, 423, 488, 622` (CORS), `functions/hosting-promote.js:7-11`, `.firebaserc`,
`DEPLOYMENT.md`. Env/secrets referenced by functions: `SUPER_ADMIN_BOOTSTRAP_EMAILS`, `TELEGRAM_BOT_TOKEN`,
`GEMINI_API_KEY`, `HOSTING_*`. The Telegram proxy holds a Vercel OIDC token in `.env.local` (never committed).

## 5. Firestore collections

| Path | Purpose |
|---|---|
| `users/{uid}` | Profile, `role` (`user`/`subUser`/`superAdmin`), `parentAdminId`, `permissions{}`, `isActive`, store name/subdomain, phone |
| `stores/{ownerUid}`, `storeSubdomains/{sub}` | Store registry and unique subdomain reservation |
| `subscriptions/{ownerUid}` | `activated`, `lifetime`, `startDate`/`endDate` (ISO strings), `type`, `code` |
| `userData/{ownerUid}` | V1: giant arrays (products, sales, ...). V2: meta only |
| `userData/{ownerUid}/{products,customers,sales,suppliers,purchases,supplierPayments,purchaseReturns,supplierLedger,cashDrawerTx,deletedProducts,counters,settings,cashDrawer}` | Tenant data (V2) |
| `cashbox/{tenantId}` (+`/transactions`) | Shared drawer balance (cents) |
| `_serverTime/{uid}` | Clock probe written on every activation check |
| `appControl/{update,features,deployment}` | Update rollout and feature flags |
| `usageStats`, `systemErrors`, `adminAuditLogs`, `emailVerifications`, `mail` | Telemetry/admin |
| `products`, `orders`, `sales`, `purchases`, `customers`, `suppliers`, `inventory` (top level) | **Dead** V0 collections still in rules |

## 6. Authentication model

Email/password. Signup creates the Auth user, then the **client** writes `users`, `stores`,
`storeSubdomains`, `userData` docs. Email verification by link. Sub-users are created by an HTTP function.
Super admin = custom claim `super_admin` bootstrapped from an email allow-list.
New accounts are **inactive until the Super Admin activates a subscription** (self-activation disabled).

## 7. Roles and permissions

Owner (all permissions), sub-user (`role: 'subUser'`, `parentAdminId`), super admin (claim).
Sub-user permission keys: `canSell`, `canEditPrice`, `canViewSales`, `canViewProducts`, `canAddProducts`,
`canEditProducts`, `canDeleteProducts`, `canImportProducts`, `canExportProducts`, `canViewCustomers`,
`canViewReports`, `canViewSuppliers`, `canManageCashDrawer`, `canViewSettings`, `canEditSettings`,
`canViewCosts`, `canViewSensitiveData`, `canManageUsers`.
Enforcement is **client-side only**; Firestore rules gate only "same store vs not" (except a handful of
write paths) and resolve the owner through ~20 alternative field names.

## 8. Major POS modules

Dashboard · POS (10 cart tabs, retail/wholesale/VIP prices, USD/LBP, cash with automatic LBP remainder,
credit sale with previous-debt line, barcode scanner, IMEI, F2/F9/F4 keys) · Cashbox history & cash moves ·
Products (3 price tiers, manual LBP prices, cost lock, categories, stock adjust with weighted average cost,
carton/pack conversion for two hard-coded stores, images, barcode labels) · Expiry management · Sales
(filters, invoice print thermal 80mm/A4, full/partial returns) · Customers (credit limit, debt, pay debt,
history) · Suppliers (balance, payments applied oldest-bill-first, history) · Purchases/purchase returns ·
Reports (sales, inventory, customers, profit, capital, expenses, CSV) · Settings (store, logo, exchange
rate, Telegram, AI insights, backup/import, security code, clear data) · Users (sub-users) · Super Admin
(subscriptions, delete account, update rollout, feature flags, observability) · Arabic/English + RTL · themes.

## 9. Current data flow

UI event → mutate global arrays → `saveToStorage` (OPFS + SQLite export + IndexedDB/localStorage on
**every** write) → `enqueueSyncOp` → debounced `v2BatchWrite` (450 ops) → Firestore.
Read: boot hydrates local cache, then merges cloud docs by `updatedAt` (last-write-wins, products take
`max(stock)` on ties), polls every 5 minutes. Only products propagate deletes.

## 10. Security issues

1. Admin "security code" defaults to `"00"` and typing `00` bypasses all privileged checks (`script.js:3930`, `24111`).
2. All permissions are UI-only; any sub-user can write any customer/supplier/cash data via the console.
3. Subscription check returns *active* whenever the device is offline (`script.js:3459`).
4. `createSubUser` lets an owner take over any Auth account that has no `users` doc.
5. Super-admin bootstrap does not require a verified email.
6. Telegram bot token and proxy secret stored in synced settings readable by every store member.
7. XSS: ~200 `innerHTML` sinks, unescaped product/store names in print windows and a `<script>` literal.
8. CSV export without quote escaping or formula-injection protection.
9. `clearStorage` wipes every tenant's local data on the device; exports include license state.
10. `appControl/features` and sub-user permission docs written directly from the client.

## 11. Performance issues

Full SQLite export to IndexedDB on every save; `getCurrentProducts()` re-merges three sources on every
call; O(n²) report loops; permission polling every 5 s per sub-user; dashboard re-parses storage every 5 s;
translation pass every 3 s; duplicate event listeners on every POS load; heavy console logging; 738 KB CSS;
unpinned CDN scripts without SRI.

## 12. Code quality issues

38k-line single file; a **missing closing brace** (`updateSalesSortIcons`, L37252) nests ~1,100 lines
(purchases system, subscription timers, `contactSupport`) inside a function so they never run at load;
three language-init paths and 4 translation maps; duplicate DOM ids; dead code (Supabase stubs,
`SecureLicenseStorage`, unused license module, unreachable product grid); ~20 owner-id field aliases.

## 13. Bugs that change money/stock (fixed in the rebuild, see MIGRATION_NOTES.md)

- Concurrent sales on two devices overwrite each other's stock (snapshot merge, not delta).
- Sale returns and purchase returns never sync to the cloud; dashboard reads `returnDate` but return sets `returnedDate`.
- Credit-sale refunds reduce debt by the full refund **and** return the cash paid (double refund).
- Sale `amount` includes the settled previous-debt line → revenue overstated.
- Offline invoice numbers collide across devices.
- Profit uses the product's *current* cost (no cost snapshot on the sale line); quantities truncated with `parseInt`.
- Financial report applies a hard-coded 11 % tax although tax was removed everywhere else.
- Backup export writes `data_<date>.json` but import expects `data.json`.
- Supplier "card/bank" payments still deduct from the cash drawer; purchase returns can exceed purchased qty.

## 14. Features at risk during migration

Offline selling, cart tabs persistence, automatic LBP remainder, previous-debt line in cart, IMEI flows,
carton/pack conversion (hard-coded to two stores), thermal receipt layout, Telegram notifications,
per-store subdomain links, Arabic RTL, sub-user permission matrix, super-admin subscription tools.

## 15. New React architecture (implemented)

React 19 + TypeScript + Vite, React Router with lazy routes, feature folders (`src/features/*`),
service layer per domain (`src/services/*`), shared tenant data store with ref-counted Firestore
listeners, integer money helpers, zod validation, lightweight i18n (en/ar + RTL), plain CSS design tokens.
See `docs/ARCHITECTURE.md`.

## 16. New Firebase architecture (implemented)

Modular SDK with persistent multi-tab cache; tenant root `tenants/{ownerUid}`; custom claims
`tenantId`/`role`/`superAdmin`; money-and-stock changes in atomic Firestore transactions (online) or
batched writes with `increment()` (offline) that must be accompanied by a ledger/movement document;
deny-by-default, permission-aware security rules that also enforce subscription status on writes;
TypeScript Cloud Functions (v2) for signup, sub-users, subscriptions, super-admin, data wipe and Telegram.
See `docs/FIRESTORE.md` and `docs/SECURITY.md`.

## 17. Migration risks and order

Risks: behaviour drift in money calculations, losing offline capability, permission regressions,
accidental connection to the old project. Mitigations: calculations ported into pure, unit-tested
functions (`src/domain`), isolation guard at build/runtime/deploy, emulator-only testing with a `demo-`
project. Order followed: isolation → audit → foundation → auth/layout → services → products →
POS → customers/suppliers → purchases/cashbox → reports/settings/users/super admin → functions/rules →
tests → cleanup → docs.
