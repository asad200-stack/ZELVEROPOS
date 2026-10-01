# Phase 3 — Manual verification guide (Scenario G, Scenario H, shared-device isolation)

Everything here runs **only** against the local Firebase emulators (project `demo-zelvero`) and a local
preview server. Nothing touches `zelvoropos` or `pos-catch`. Nothing is deployed.

Treat the **server state (`zstate`) and the IndexedDB queue** as the authoritative evidence. The UI checks
are supporting evidence only.

---

## 0. One-time setup

### 0.1 Terminals

Open three PowerShell windows. In each, run:

```powershell
cd "C:\Users\asad2\OneDrive\سطح المكتب\zelvoro pos"
```

| Window | Purpose |
|---|---|
| **T1** | Firebase emulators (keep running for the whole session; data lives in memory) |
| **T2** | Preview server (`http://localhost:4173`) |
| **T3** | Commands: builds, `zstate`, resets |

### 0.2 The `zstate` command (server evidence)

Paste this into **T3** once per window. It reads the emulator directly, so security rules don't apply
(this only works against the emulator):

```powershell
function zstate {
  $B = 'http://127.0.0.1:8080/v1/projects/demo-zelvero/databases/(default)/documents/tenants/demoStore'
  $H = @{ Authorization = 'Bearer owner' }
  function V($f) { if ($null -eq $f) { return $null }; foreach ($k in 'integerValue','stringValue','doubleValue','booleanValue') { if ($f.PSObject.Properties[$k]) { return $f.$k } }; if ($f.PSObject.Properties['nullValue']) { return 'null' }; return '?' }
  function Docs($c) { $r = Invoke-RestMethod -Uri "$B/$($c)?pageSize=300" -Headers $H; if ($r.documents) { $r.documents } else { @() } }
  function One($p) { Invoke-RestMethod -Uri "$B/$p" -Headers $H }
  $id = { $_.name.Split('/')[-1] }
  "== DRAWER (cashbox/summary): usdCents=$(V (One 'cashbox/summary').fields.usdCents)  lbp=$(V (One 'cashbox/summary').fields.lbp)"
  "== NEXT INVOICE (counters/sales.nextId): $(V (One 'counters/sales').fields.nextId)"
  "== STOCK"
  Docs 'products' | ForEach-Object { [pscustomobject]@{ product = (& $id); stock = V $_.fields.stock } } | Format-Table -AutoSize | Out-String -Width 200
  $sales = @(Docs 'sales')
  "== SALES: $($sales.Count)"
  $sales | ForEach-Object { [pscustomobject]@{ saleId = (& $id); invoice = V $_.fields.invoiceNumber; offlineRef = V $_.fields.offlineRef; offline = V $_.fields.offline; totalUsdCents = V $_.fields.totalUsdCents; receivedUsdCents = V $_.fields.payment.mapValue.fields.receivedUsdCents; createdBy = V $_.fields.createdBy } } | Format-Table -AutoSize | Out-String -Width 250
  $mv = @(Docs 'stockMovements')
  "== STOCK MOVEMENTS: $($mv.Count)"
  $mv | ForEach-Object { [pscustomobject]@{ product = V $_.fields.productId; type = V $_.fields.type; qty = V $_.fields.quantity; stockAfter = V $_.fields.stockAfter; saleId = V $_.fields.refId; ref = V $_.fields.refNumber } } | Format-Table -AutoSize | Out-String -Width 250
  $tx = @(Docs 'cashTransactions')
  "== CASH TRANSACTIONS: $($tx.Count)"
  $tx | ForEach-Object { [pscustomobject]@{ type = V $_.fields.type; usdCents = V $_.fields.usdCents; lbp = V $_.fields.lbp; balanceAfterUsd = V $_.fields.balanceAfter.mapValue.fields.usdCents; saleId = V $_.fields.refId; ref = V $_.fields.refNumber } } | Format-Table -AutoSize | Out-String -Width 250
}
```

Right after a reset and seed, `zstate` must print exactly:

```
== DRAWER (cashbox/summary): usdCents=10000  lbp=0
== NEXT INVOICE (counters/sales.nextId): 1
== STOCK   cable 20 / case 20 / last 1 / phone 2
== SALES: 0
== STOCK MOVEMENTS: 0
== CASH TRANSACTIONS: 0
```

You can also browse the same data visually in the Emulator UI at `http://127.0.0.1:4000/firestore`, under
`tenants › demoStore`.

### 0.3 Dedicated test browser

Use a **separate Chrome instance with its own profile**, so your normal browser, its extensions and its data
are never involved. It is launched in one of two modes:

**Normal (online) launch:**

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="$env:TEMP\zelvero-chrome" --no-first-run --no-default-browser-check "http://localhost:4173/login"
```

**Zero-connectivity launch.** Every request, including `localhost` and `127.0.0.1`, goes to a dead proxy and
fails:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="$env:TEMP\zelvero-chrome" --no-first-run --no-default-browser-check --proxy-server="http://127.0.0.1:9" --proxy-bypass-list="<-loopback>" "http://localhost:4173/pos"
```

Why this approach:

- The emulators keep their data in memory, so they must stay running.
- Windows airplane mode does **not** block `localhost`.
- The dead proxy makes the app server and all Firebase endpoints unreachable **for the test browser only**,
  and the setting survives closing and reopening tabs. I verified that it blocks `127.0.0.1` on this machine.
- `zstate` in T3 keeps working, because it does not go through the browser.

**Before every relaunch, the previous instance must be fully closed.** Otherwise Chrome reuses the running
process and silently ignores the new flags.

1. Close all windows of the test instance.
2. In **T3**, run the check below. It must print `0`:

   ```powershell
   (Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object CommandLine -like '*zelvero-chrome*' | Measure-Object).Count
   ```

   If it is not `0`, end those processes:

   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object CommandLine -like '*zelvero-chrome*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
   ```

3. After a zero-connectivity launch, open a new tab at `chrome://version` and confirm that the **Command Line**
   row contains `--proxy-server=http://127.0.0.1:9`. Then close that tab.

### 0.4 Browser console snippets (IndexedDB queue, worker, carts)

1. Open DevTools with **F12** on the `http://localhost:4173` tab and choose the **Console** tab.
2. The first time, Chrome blocks pasting. Type `allow pasting` and press Enter.
3. Each snippet is read-only.

**Q — offline queue (IndexedDB `zelvero-offline` › `operations`):**

```js
(async () => {
  if (!(await indexedDB.databases()).some((d) => d.name === 'zelvero-offline')) return 'no zelvero-offline database yet (0 records)';
  const db = await new Promise((ok, err) => { const r = indexedDB.open('zelvero-offline'); r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });
  const ops = await new Promise((ok) => { const r = db.transaction('operations').objectStore('operations').getAll(); r.onsuccess = () => ok(r.result); });
  db.close();
  console.table(ops.map((o) => ({ id: o.id, uid: o.uid, tenant: o.tenantId, status: o.status, offlineRef: o.offlineRef, attempts: o.attempts, invoice: o.result?.invoiceNumber ?? null, totalUsdCents: o.snapshot.totalUsdCents, cashUsdCents: o.snapshot.received.usdCents })));
  return `${ops.length} record(s); pending (PENDING_SYNC/SYNCING) = ${ops.filter((o) => o.status === 'PENDING_SYNC' || o.status === 'SYNCING').length}`;
})()
```

**S — service worker version, active/waiting worker, caches:**

```js
(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const ask = (w) => (w ? new Promise((ok) => { const ch = new MessageChannel(); ch.port1.onmessage = (e) => ok(e.data.version); w.postMessage({ type: 'GET_VERSION' }, [ch.port2]); setTimeout(() => ok('no reply'), 2000); }) : null);
  const meta = (await caches.has('zelvero-sw-meta')) ? await (await (await caches.open('zelvero-sw-meta')).match('/__sw-state'))?.json() : null;
  return { online: navigator.onLine, controlledBy: await ask(navigator.serviceWorker.controller), active: await ask(reg?.active), waiting: await ask(reg?.waiting), installing: reg?.installing?.state ?? null, caches: await caches.keys(), meta };
})()
```

**C — carts stored on this device (per store and per user):**

```js
Object.entries(localStorage).filter(([k]) => k.startsWith('zelvero.cart.')).map(([k, v]) => [k, JSON.parse(v).carts.map((c) => c.lines.map((l) => `${l.name} x${l.quantity}`).join(', ') || '(empty)')])
```

**M — reload marker.** Proves the page did not reload. If the marker survives, the page did not reload:

```js
window.__marker ??= Date.now()   // set it
window.__marker                  // later: still the same number = no reload; undefined = the page reloaded
```

### 0.5 DevTools panels used

The **Application** tab is in the DevTools top bar; if it is hidden, click **»** to find it.

- **Application › Service workers.** Shows the status line (`#N activated and is running`, or
  `#M waiting to activate`) and the source `sw.js`.
  - The checkboxes **Offline**, **Update on reload** and **Bypass for network** must all stay **unchecked**.
  - Do **not** click `skipWaiting`. That would bypass the app's "refresh when ready" flow.
  - Clicking **Update** is allowed; it only checks for a new version.
- **Application › Storage › IndexedDB › `zelvero-offline` › `operations`.** The same records that snippet Q
  prints. Right-click the store and choose Refresh to update the view.
- **Application › Cache storage.** Should contain only `zelvero-shell-<version>` caches and `zelvero-sw-meta`.
- **Network › throttling dropdown** (says "No throttling"): **Offline**. Use it only as the fallback
  described in G5.
- **⋮ (DevTools menu) › More tools › Network request blocking.** Used in the isolation test.

---

## A. Full pre-test reset (run before Scenario G)

1. **Close the test browser** and confirm the process count is `0` (section 0.3).
2. **Delete the test profile.** This removes the service worker, caches, IndexedDB queue, localStorage and
   cookies of the test browser only:
   ```powershell
   Remove-Item -Recurse -Force "$env:TEMP\zelvero-chrome" -ErrorAction SilentlyContinue
   ```
3. **Start the emulators in T1**, if they are not already running. Wait for "All emulators ready":
   ```powershell
   $env:Path = "$env:JAVA_HOME\bin;$env:Path"; $env:FUNCTIONS_DISCOVERY_TIMEOUT = "90"; npm --prefix functions run build; npx firebase-tools emulators:start --only auth,firestore,functions,storage --project demo-zelvero
   ```
4. **Wipe the emulator data and reseed in T3.** This restores the auth users, a clean Firestore, no sales,
   drawer 10000, known stock and invoice counter 1:
   ```powershell
   Invoke-RestMethod -Method Delete -Uri 'http://127.0.0.1:8080/emulator/v1/projects/demo-zelvero/databases/(default)/documents' | Out-Null
   Invoke-RestMethod -Method Delete -Uri 'http://127.0.0.1:9099/emulator/v1/projects/demo-zelvero/accounts' | Out-Null
   node scripts/seed-emulator.mjs
   zstate
   ```
   `zstate` must match the baseline in section 0.2.
5. **Build the app in T3** and write down the version it prints:
   ```powershell
   Remove-Item Env:ZELVERO_BUILD_TAG -ErrorAction SilentlyContinue; npx vite build --mode emulator; npm run verify:shell
   ```
   The build prints `[sw] dist/sw.js: 51 app-shell files, version <V1>`, and verification prints
   `✓ app shell complete`. Write down **V1**.
6. **Start the preview in T2** and leave it running:
   ```powershell
   npx vite preview --mode emulator --port 4173 --strictPort
   ```

Test accounts, all with password `demo-pass-1`:

- `cashier@zelvero.test` (cashier1)
- `cashier2@zelvero.test` (cashier2)
- `owner@zelvero.test`

---

## SCENARIO G — Full offline cold-start sale flow

Starting condition: reset A done, preview running, test browser **not** open yet.

### G1. Open the POS online

1. Use the **normal launch** command (section 0.3).
2. Sign in as `cashier@zelvero.test` / `demo-pass-1`.
3. Click **Point of sale** in the sidebar.
4. Wait until the four products appear.

**UI:**

- The header shows **Demo Store** and a green **Online** chip.
- Products: Demo phone $200.00 (2 in stock), Last-unit charger $9.00 (1), Phone case $5.00 (20),
  USB cable $3.00 (20).

### G2. Service worker controls the page

**UI (DevTools):** Application › Service workers shows `sw.js`, status `#… activated and is running`, and
no "waiting" entry.

**Check (snippet S):**

- `controlledBy` = `active` = **V1**
- `waiting: null`
- `caches` contains `zelvero-shell-V1` and `zelvero-sw-meta`

If `controlledBy` is `null`, reload the page once and repeat. The very first load installs the worker, and
it takes control immediately.

### G3. The offline queue is empty

**UI:** no "N pending" or "Action required" chip in the header.

**Check (snippet Q):** `no zelvero-offline database yet (0 records)`, or `0 record(s); pending … = 0`.

### G4. Starting values

**Check (T3):** run `zstate`. It must show drawer `10000`, `case` stock `20`, next invoice `1`, sales `0`,
stock movements `0` and cash transactions `0`.

The sale in G9 will be **1 × Phone case at $5.00, paid in cash**.

### G5. Make the app server and Firebase unreachable

1. In **T2**, press **Ctrl+C** to stop the preview server.
2. Confirm in **T3** that nothing is listening on the app port. The command must print nothing:
   ```powershell
   netstat -ano | Select-String ':4173\s.*LISTENING'
   ```
3. Turn on **Windows airplane mode**: Win+A, then click Airplane mode. This makes the browser report
   `navigator.onLine = false`, which shows the OFFLINE chip. It does not block localhost; the dead proxy
   does that.
4. **Leave T1 (emulators) running.**

### G6. Close the POS tab completely

1. Close every window of the test browser.
2. Run the process check (section 0.3). It must print `0`.

### G7. Reopen `/pos` while fully offline

1. Use the **zero-connectivity launch** command (it opens `http://localhost:4173/pos`).
2. Confirm the proxy flag in `chrome://version` (section 0.3), then close that tab.

### G8. Verify the offline start

**UI:**

- The app loads; there is no Chrome "No internet" / dinosaur page.
- The header shows **Demo Store** and an orange **Offline** chip.
- The four products appear (from Firestore's own offline cache).
- A banner on the POS page says "You are offline. Completed sales are saved on this device as PENDING …".

**Check (snippet S):** `online: false`, and `controlledBy` = **V1**.

**Check (DevTools › Network tab, reload once):**

- The document and `/assets/*` rows show **(ServiceWorker)** in the Size column.
- Requests to `127.0.0.1:8080`, `127.0.0.1:9099` and `127.0.0.1:5001` show as failed
  (`net::ERR_PROXY_CONNECTION_FAILED`). None are served by the ServiceWorker.

**If `online` is still `true`** (virtual network adapters, such as Hyper-V, WSL or VPN, can keep Chrome
"online" in airplane mode):

1. Open DevTools › Network › throttling dropdown and choose **Offline**.
2. Keep DevTools open on this tab for the rest of the offline steps, and re-apply it after each reopen.
3. Note in your results that you used this fallback.

### G9. Create one offline cash sale

1. Click **Phone case** once. The cart shows 1 × Phone case, total $5.00.
2. Leave **Amount received** empty (this means the full amount) and the currency on USD.
3. Click **Complete sale** (or press F9).

### G10. Verify the offline sale

**UI (the result dialog):**

- The title reads **"Offline sale saved — pending sync"**.
- An orange **Pending sync** badge.
- A large reference `OFF-XXXXXX` and the total `$5.00`.
- A warning: "Saved on this device only. This is NOT an official invoice yet …".
- A red warning: **"Cash received ($5.00) is physically with you but is NOT recorded in the official cash
  drawer until this sale is synchronized."**
- **No `INV-…` number anywhere.**

Then:

- Click **Print offline proof**. The print preview shows **"OFFLINE SALE — PENDING SYNCHRONIZATION"**,
  "NOT AN OFFICIAL INVOICE …", "Offline ref. OFF-XXXXXX" and no INV number. Cancel the print dialog, or save
  it as PDF for your evidence.
- Close the dialog. The header shows an orange **"1 pending"** chip. Clicking it opens **Offline sales
  queue**, where the row shows `OFF-XXXXXX`, status **Pending sync**, attempts `0` and an empty "Official
  invoice" column.

**Check (snippet Q):** 1 record, with `uid: cashier1`, `tenant: demoStore`, `status: PENDING_SYNC`,
`offlineRef: OFF-XXXXXX`, `invoice: null`, `totalUsdCents: 500` and `cashUsdCents: 500`.

**Check (T3, `zstate`):** unchanged from G4, with **SALES: 0** and drawer `10000`. This proves nothing
reached the server.

### G11. Record the reference

Write down the exact `OFF-XXXXXX` and the record `id` from snippet Q. The `id` is the future server sale
document id.

### G12. Close the tab completely

Close all windows of the test browser. The process check must print `0`.

### G13. Reopen while still fully offline

Relaunch with the **zero-connectivity** command, and confirm the proxy flag in `chrome://version`. Airplane
mode stays on and the preview stays stopped.

### G14. The pending sale is still visible

**UI:**

- The app shell loads and shows the **Offline** chip.
- The **"1 pending"** chip is back.
- The queue panel shows the same `OFF-XXXXXX` as **Pending sync**.

### G15. The queue record survived in IndexedDB

**Check (snippet Q):** the same `id` and `OFF-XXXXXX`, still `PENDING_SYNC`, `attempts: 0` and
`invoice: null`. Optionally, open Application › IndexedDB › `zelvero-offline` › `operations` and inspect the
record.

**Check (T3, `zstate`):** still **SALES: 0**, drawer `10000` and case `20`.

### G16. Restore the network

1. Turn **airplane mode off**. If you used the DevTools **Offline** fallback, set it back to "No throttling".
2. Start the preview again in **T2**, and do **not** rebuild:
   `npx vite preview --mode emulator --port 4173 --strictPort`
3. Close all test-browser windows. The process check must print `0`.
4. Relaunch with the **normal** command. It opens `/login`; if you are still signed in, the app forwards you
   automatically.
5. Navigate to **Point of sale**.

The zero-connectivity mode is a launch flag, so restoring the network means relaunching the browser without
it.

### G17. Wait for synchronization

It normally happens within a few seconds of the app starting; the queue polls every 20 s. The header
briefly shows **Syncing…**, then the "1 pending" chip disappears and a small history icon chip remains.

### G18. Verify the result

**UI:**

1. Click the history chip to open **Offline sales queue**.
2. Tick **Show handled and synced**. The row `OFF-XXXXXX` shows status **Synced**, with Official invoice
   **INV-001**.
3. Optionally, reopen it and print the proof. It now says "Synchronized — official invoice INV-001".

**Check (snippet Q):** the same `id`, `status: SYNCED`, `invoice: INV-001`, and `attempts: 1`. Attempts is
normally 1 because sending was skipped while offline. A higher number is acceptable **only if** `zstate`
still shows exactly one sale, because every attempt reuses the same id.

**Check (T3, `zstate`), each exactly once:**

| Check | Expected |
|---|---|
| SALES | **1**: `saleId` = the queue `id` from G11, `invoice INV-001`, `offlineRef OFF-XXXXXX`, `offline True`, `totalUsdCents 500`, `receivedUsdCents 500`, `createdBy cashier1` |
| Drawer | **10500** (10000 + 500) |
| Stock | `case` **19**; the other products unchanged |
| Next invoice | **2** |
| Stock movements | **1**: product `case`, type `sale`, qty `-1`, stockAfter `19`, `saleId` = the queue `id`, ref `INV-001` |
| Cash transactions | **1**: type `sale`, usdCents `500`, balanceAfterUsd `10500`, `saleId` = the queue `id`, ref `INV-001` |

The OFF reference is linked to the official invoice because the **same server sale document** carries both
`offlineRef OFF-XXXXXX` and `invoice INV-001`, and its id equals the offline record id.

### G19. Refresh again: no duplicate sync

1. Press F5 twice, waiting about 30 s after each (longer than one polling interval).
2. **Snippet Q:** still `SYNCED`, and `attempts` is unchanged.
3. **`zstate`:** identical to G18. That means 1 sale, drawer 10500, case 19, next invoice 2, 1 movement and
   1 cash transaction.

---

## B. Reset between Scenario G and Scenario H

Scenario H needs the **installed worker version V1**, so do **not** delete the test profile and do **not**
rebuild before H starts.

1. The preview must be running (T2) with the **same V1 build** used in G.
2. Airplane mode must be off. The test browser must be a **normal** launch (no proxy), with DevTools
   throttling set to "No throttling".
3. **Snippet Q:** pending must be `0`. The synced G record may remain; that is expected.
4. **Snippet S:** `controlledBy` = `active` = **V1**, and `waiting: null`.
5. **T3:** run `zstate` and record it as the **H baseline**. Do not wipe the server; the G sale can stay.

---

## SCENARIO H — Update safety with an active cart

### H1. Start on the current version

On `/pos`, signed in as cashier1:

- **Snippet S:** `controlledBy` = `active` = **V1**, `waiting: null`, and exactly one `zelvero-shell-…` cache.
- **Snippet M:** run `window.__marker ??= Date.now()` and write the number down.

### H2. Put work in the cart and do not complete it

1. Click **Phone case** twice and **USB cable** once. The cart shows Phone case × 2 and USB cable × 1, total
   $13.00.
2. **Snippet C:** `zelvero.cart.demoStore.cashier1` contains `Phone case x2, USB cable x1`.

### H3. Build a new version while the page stays open

In **T3** (the preview keeps running in T2):

```powershell
$env:ZELVERO_BUILD_TAG = 'scenario-h-1'; npx vite build --mode emulator; Remove-Item Env:ZELVERO_BUILD_TAG
```

Write down the new version it prints, **V2** (it must differ from V1).

Then make the page check for updates:

- **Either** switch to another tab for about 3 seconds and back (the app checks when the tab becomes visible),
- **or** click **Update** in Application › Service workers.

The build tag only changes `sw.js` and its cache name; the app's JS files are byte-identical. That is enough
to publish a new worker version without editing code.

### H4. Verify: installed, waiting, no reload, cart intact, notice shown

**UI:**

- Bottom-left (bottom-right in Arabic) shows **"New version available — refresh when ready"** with a
  **Refresh** button.
- The cart still shows Phone case × 2 and USB cable × 1 ($13.00).
- Nothing reloaded or flickered.

**Application › Service workers:** two entries, `#… activated and is running` (V1) and
`#… waiting to activate` (V2).

**Snippet S:**

- `controlledBy` = `active` = **V1** and `waiting` = **V2**.
- `caches` contains both `zelvero-shell-V1` and `zelvero-shell-V2`.
- `meta.current` = `zelvero-shell-V1`.

**Snippet M:** `window.__marker` returns the **same number** as in H1, so the page did not reload.

**Snippet C:** the cart is unchanged.

**Optional safety check:**

1. Click **Refresh** now, while the cart still has items.
2. A dialog **"Finish your current work first?"** appears. Click **Cancel**.
3. Confirm that `window.__marker` is unchanged, the cart is intact and the worker is still waiting.

### H5. Finish the cashier's work

Complete the sale online: leave Amount received empty and click **Complete sale**. The dialog shows **Sale
completed** with **INV-002** (assuming G was run first). Close it; the cart is now empty.

**`zstate` (compared with the H baseline):**

- sales **+1** (`INV-002`, offlineRef `null`)
- drawer **+1300**
- `case` **−2**
- `cable` **−1**
- next invoice **+1**
- stock movements **+2** (one per product)
- cash transactions **+1**

### H6. Press Refresh

Click **Refresh** on the notice. The cart is empty, so there is no confirmation dialog, and the page reloads
once.

### H7. Verify: new worker active, new version loaded, nothing lost

**UI:** the POS loads normally and the notice is gone.

**Application › Service workers:** a single `#… activated and is running` entry, with no waiting entry.

**Snippet S:**

- `controlledBy` = `active` = **V2** and `waiting: null`.
- `caches` contains **both** `zelvero-shell-V1` and `zelvero-shell-V2`.
- `meta` = `{ current: 'zelvero-shell-V2', previous: 'zelvero-shell-V1' }`.

Keeping V1 is the intended design: one previous version stays available so tabs still running the old
bundle can load their lazy chunks.

**Snippet M:** `window.__marker` is `undefined`. The reload happened only now, when you asked for it.

**Nothing lost:** `zstate` equals the result of H5 (INV-002 exists exactly once), and **snippet Q** shows no
pending records.

### H8. Stale caches are cleaned safely

Publish one more version:

```powershell
$env:ZELVERO_BUILD_TAG = 'scenario-h-2'; npx vite build --mode emulator; Remove-Item Env:ZELVERO_BUILD_TAG
```

This produces **V3**.

1. Switch tabs away and back.
2. The notice appears. Click **Refresh**.

**Snippet S:**

- `controlledBy` = **V3**.
- `caches` contains **only** `zelvero-shell-V2`, `zelvero-shell-V3` and `zelvero-sw-meta`. **V1 is gone.**
- `meta` = `{ current: V3, previous: V2 }`.

**Application › Cache storage** shows the same list.

---

## C. Reset before the shared-device isolation test

The isolation test is independent of the worker, so start from a fully clean state:

1. Close the test browser (the process check must print `0`).
2. Delete the profile:
   ```powershell
   Remove-Item -Recurse -Force "$env:TEMP\zelvero-chrome" -ErrorAction SilentlyContinue
   ```
3. Wipe and reseed the emulators, then run `zstate` (the same commands as reset A, step 4). It must match the
   baseline.
4. The preview must be running in T2. Any of the builds is fine.

Repeat this reset if you need to run the isolation test again.

---

## SHARED-DEVICE / USER ISOLATION

Both users belong to the same store (`demoStore`), so products and store settings are *meant* to be
visible to both. What must be isolated per user is the **offline queue** and the **POS carts**.

To keep Auth and Firestore reachable, so that users can sign in and out, only the **Cloud Functions
endpoint** is blocked. Checkout then fails in transit, and the sale is queued exactly like an offline sale
(this is the "network error" path of the same queue).

### I1. cashier1 signs in

1. Use the **normal launch**, sign in as `cashier@zelvero.test`, and open **Point of sale**.
2. Open DevTools (F12) › **⋮** › **More tools** › **Network request blocking**.
3. Tick **Enable network request blocking**, click **+**, add the pattern `*127.0.0.1:5001*` and press
   **Add**.
4. Keep DevTools open on this tab for the whole test; the blocking only applies while it is open.

### I2. cashier1 creates a pending sale and leaves work in a cart

1. Click **Phone case** and click **Complete sale**.
2. The dialog shows **"Offline sale saved — pending sync"**, an `OFF-XXXXXX` reference, and "The server
   could not be reached, so the sale was saved on this device …", plus the cash warning.
3. Write down the `OFF-XXXXXX`.
4. Close the dialog.
5. Click **USB cable** once and **do not** complete this sale. It stays in cashier1's cart.

**Check:**

- The header shows **"1 pending"**.
- **Snippet Q:** 1 record, `uid: cashier1`, `PENDING_SYNC`.
- **Snippet C:** `zelvero.cart.demoStore.cashier1` contains `USB cable x1`.
- **`zstate`:** SALES **0**, drawer `10000`, case `20`.

### I3. cashier1 signs out

Click **Sign out** at the bottom of the sidebar. You land on the login page.

**Check (snippet Q):** the record is **still there**, with `uid: cashier1` and `PENDING_SYNC`.

### I4. cashier2 signs in on the same browser

Sign in as `cashier2@zelvero.test` / `demo-pass-1` and open **Point of sale**.

### I5. cashier2 does not see cashier1's queue

**UI:**

- **No** "1 pending" chip and **no** queue chip in the header.
- cashier2 has no queue entries, so there is nothing to open.

### I6. cashier2 does not see cashier1's carts

**UI:** cashier2's cart is **empty**. cashier1's `USB cable` is **not** shown, and no "Cashier One" data or
cashier1 receipt is visible.

**Check (snippet C):**

- `zelvero.cart.demoStore.cashier1` still exists with `USB cable x1`. It is cashier1's and untouched.
- cashier2's key (`zelvero.cart.demoStore.cashier2`) is empty.

Seeing cashier1's record through DevTools is **not** a failure. DevTools reads the device's raw storage,
which is a stated limitation: local storage is not encrypted. The requirement is that the **app UI** does not
show it.

### I7. cashier1's operation is not deleted, and is not sent by cashier2's session

1. In **Network request blocking**, **untick** "Enable network request blocking", so Functions are reachable.
2. Wait **60 seconds** (three polling intervals) while cashier2 stays signed in.

**Check (snippet Q):**

- cashier1's record is **still `PENDING_SYNC`**, with `uid: cashier1`.
- `attempts` is **unchanged** from I3.

**Check (`zstate`):** SALES **0**, drawer `10000` and case `20`. cashier2's session must never send
cashier1's sale.

### I8. cashier2 signs out

1. **First re-tick** "Enable network request blocking", so the reappearance can be seen before it syncs.
2. Click **Sign out**.

### I9. cashier1 signs back in

Sign in as `cashier@zelvero.test` and open **Point of sale**.

### I10. cashier1's pending operation reappears

**UI:**

- The **"1 pending"** chip is back. Clicking it shows the same `OFF-XXXXXX` as **Pending sync**.
- The cart again shows cashier1's **USB cable × 1**.

**Check (snippet Q):** the same record, `PENDING_SYNC`, and `attempts` may have increased by the blocked
tries.

### I11. After reconnecting, it syncs normally

1. **Untick** "Enable network request blocking".
2. Wait. The queue panel shows "Next automatic retry …", which is at most about a minute after a few blocked
   tries. Leave the panel open and wait until that time passes.
3. If the row shows **Retries paused**, click **Retry**.

**UI:** the row becomes **Synced** (tick **Show handled and synced**), with Official invoice **INV-001**.

**Check (snippet Q):** `SYNCED`, `invoice: INV-001`.

**Check (`zstate`), each exactly once:**

- **1** sale: `INV-001`, offlineRef = your `OFF-XXXXXX`, `createdBy cashier1`
- drawer **10500**
- `case` **19**
- next invoice **2**
- **1** stock movement
- **1** cash transaction

Finally, clear the blocking list: select the pattern and click the delete icon.

### Cross-tenant isolation

**Not testable with the current seed.** `scripts/seed-emulator.mjs` creates only one store (`demoStore`).
Testing a second store requires adding a second-store seed, which is a code change, so I did not make it.
The code-level protections that cover this case are:

- The queue shows and sends only records whose `tenantId` **and** `uid` match the signed-in user.
- Carts are keyed by store and user.
- Every Firestore query is scoped to the signed-in user's `tenantId` from their verified claims.
- Security rules and Cloud Functions re-check the tenant on the server. These are covered by the rules and
  integration suites.

---

## PASS / FAIL checklist

Write PASS or FAIL for each line, and attach the `zstate` output and the snippet Q/S output at the marked
steps.

### Scenario G

| # | PASS only if |
|---|---|
| G2 | Snippet S shows `controlledBy` = `active` = V1 and `waiting: null` |
| G3 | Snippet Q shows 0 pending |
| G4 | `zstate` = drawer 10000, case 20, next invoice 1, 0 sales, 0 movements, 0 cash transactions |
| G7–G8 | With preview stopped, the proxy flag confirmed and airplane mode on: the app renders at `/pos` with the store name, 4 products and the **Offline** chip; there is no browser offline page; Firebase requests fail and none are served by the ServiceWorker |
| G10 | The dialog shows `OFF-XXXXXX`, **Pending sync**, the "NOT an official invoice" warning and the **cash warning**, with **no INV number**; the printed proof has the OFFLINE banner; snippet Q shows 1 record, `PENDING_SYNC`, `invoice null`; `zstate` still shows **0 sales** |
| G13–G15 | After closing and reopening offline, the same `OFF` ref is still pending in the UI and in snippet Q; `zstate` is unchanged |
| G17–G18 | After restoring the network: snippet Q shows `SYNCED` with `INV-001`; `zstate` shows **exactly 1 sale** (id = the queue id, offlineRef = the OFF ref, INV-001), drawer **10500**, case **19**, next invoice **2**, **1** movement and **1** cash transaction for that sale id |
| G19 | After two refreshes, `zstate` and snippet Q are identical to G18 |

**FAIL if any of these happen:**

- The browser offline page appears in G8.
- An INV number appears before sync.
- Any server change happens while offline.
- The sale is lost after reopening.
- More than one sale, movement or cash transaction is recorded, or the drawer, stock or counter changes by
  more than one sale.

### Scenario H

| # | PASS only if |
|---|---|
| H1 | Snippet S shows V1 active and controlling, nothing waiting; the marker is set |
| H4 | After the new build: V2 is `waiting`, V1 is still active and controlling; the notice text is shown; **the marker is unchanged** (no reload); the cart is unchanged in the UI and in snippet C; the optional Refresh with items shows the confirmation, and Cancel keeps everything |
| H5 | The online sale is recorded exactly once (INV-002) with the expected deltas |
| H6–H7 | Only after Refresh is clicked: V2 is active and controlling, nothing waiting; the marker is `undefined` (one reload); caches hold V1 and V2; `meta.previous` = V1; no pending records; `zstate` is unchanged from H5 |
| H8 | After V3 is applied, caches = V2, V3 and meta only (V1 deleted); `meta` = {V3, V2} |

**FAIL if any of these happen:**

- The page reloads without Refresh being clicked.
- The cart is lost.
- V2 activates without Refresh being clicked.
- The notice doesn't appear.
- A cache for the running version is deleted.
- More than two shell caches remain after H8.

### Shared-device isolation

| # | PASS only if |
|---|---|
| I2 | cashier1's sale is queued (`PENDING_SYNC`, uid cashier1); `zstate` shows 0 sales |
| I3 | The record still exists after cashier1 signs out |
| I5–I6 | cashier2's UI shows no pending chip, no queue entries and an **empty cart**; cashier1's cart key is still intact in storage |
| I7 | With Functions reachable for 60 s under cashier2: cashier1's record is still `PENDING_SYNC` with attempts unchanged; `zstate` shows 0 sales |
| I10 | cashier1 signs back in: the same OFF ref is shown as pending, and the USB cable is back in cashier1's cart |
| I11 | After unblocking it syncs: `SYNCED`, INV-001; `zstate` shows exactly 1 sale created by cashier1, drawer 10500, case 19, next invoice 2, 1 movement and 1 cash transaction |
| Cross-tenant | **Not run**: the seed has only one store (see above) |

**FAIL if any of these happen:**

- cashier2 sees cashier1's pending sale or cart in the UI.
- cashier1's record is deleted or changed by cashier2's session.
- The sale is sent while cashier2 is signed in.
- The sale is not restored for cashier1.
- The sale syncs more than once.

---

## If something unexpected happens

Stop that scenario, and send:

- the step number;
- a screenshot;
- the snippet Q and S output;
- the `zstate` output.

Do not continue the same scenario after an unexplained change; run the matching reset and restart it.
