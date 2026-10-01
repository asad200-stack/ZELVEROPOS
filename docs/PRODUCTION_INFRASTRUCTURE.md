# ZELVERO POS — production infrastructure (Phase 4)

Firebase project `zelvoropos`, project number `185652618374`. The old CATCH POS projects
(`pos-catch`, `pos-catch-test`, number `891436013106`) are blocked by `config/firebase-isolation.json`.

## Services and locations

| Service | Resource | Location |
|---|---|---|
| Firestore | `(default)`, native mode, delete protection on | `eur3` (Europe multi-region) |
| Cloud Functions (2nd gen) | 31 functions | `europe-west1` |
| Cloud Storage | `zelvoropos.firebasestorage.app` | `EUROPE-WEST1` |
| Authentication | Firebase Auth, Email/Password only, email enumeration protection on | global |
| Hosting (classic) | site `zelvoropos` (`zelvoropos.web.app`) | global CDN |
| App Check | not configured yet (reCAPTCHA Enterprise planned) | — |

Previous configuration (replaced on 2026-10-01 before any data existed): Firestore `nam5` and
Functions `us-central1`. An unrelated App Hosting backend (`viv`) and its resources were removed.

The business time zone (`BUSINESS_TIMEZONE`, `TELEGRAM_TIMEZONE` = `Asia/Beirut`) is unrelated to the
infrastructure region.

## Functions runtime identity

All functions run as `zelvero-functions-runtime@zelvoropos.iam.gserviceaccount.com`, set once in
`functions/src/globalOptions.ts`. `functions/scripts/check-regions.mjs` runs after every Functions
build (and therefore before every deploy) and fails if any function is not in `europe-west1`, has no
instance limit, or uses another service account.

| Operation in the code | Permission needed | Role granted | Scope |
|---|---|---|---|
| Firestore reads, writes, transactions, batches, `recursiveDelete`, `bulkWriter` (all POS callables, account, sub-users, admin, tenant data) | `datastore.entities.*`, `datastore.databases.getMetadata` | `roles/datastore.user` | project |
| Auth `getUser`, `getUserByEmail`, `createUser`, `updateUser`, `deleteUser`, `setCustomUserClaims`, `revokeRefreshTokens` (claims, sub-users, signup, super admin, account deletion) | `firebaseauth.users.*` | `roles/firebaseauth.admin` | project |
| Storage `file().delete()` (product image), `deleteFiles({ prefix })` (clear tenant data, delete account) | `storage.objects.list`, `storage.objects.delete` | `roles/storage.objectUser` | POS bucket only |
| Firestore-triggered Telegram functions receive Eventarc events as this account | `eventarc.events.receiveEvent` | `roles/eventarc.eventReceiver` | project |
| Eventarc invokes the trigger services | `run.routes.invoke` | none at project level: the Firebase CLI grants `roles/run.invoker` on each trigger service to this account during deploy | per service |
| Telegram `fetch` to `api.telegram.org` | outbound internet (default for 2nd gen) | none | — |
| Logs (stdout/stderr) | collected by Cloud Run | none | — |

Not granted, because the code never needs them: Owner, Editor, Firebase Admin,
`iam.serviceAccountTokenCreator` (no custom tokens or signed URLs), Realtime Database, Secret Manager,
project-wide Storage.

## Build and deployment identities (separate from runtime)

- Cloud Build default build account: `185652618374-compute@developer.gserviceaccount.com`, granted
  only `roles/cloudbuild.builds.builder`. It builds the function images; no function runs as it.
- Deployment identity: the project owner through the Firebase CLI (`npm run deploy`, guarded by
  `scripts/firebase-guard.mjs` and a typed project-id confirmation).
- Google-managed service agents (Cloud Functions, Eventarc, Pub/Sub) receive their roles when the CLI
  enables the APIs on the first deploy.

## Launch checklist

- [ ] **Remove `localhost` from the Auth authorized domains before public launch** (kept only for
      controlled local testing).
- [ ] After the first Hosting deploy, check `Cache-Control` with `curl -I` on `/`, `/pos`,
      `/index.html`, `/sw.js` (`no-cache`) and `/assets/*` (`immutable`).
- [ ] After the first Functions deploy, confirm every service in Cloud Run runs as
      `zelvero-functions-runtime@` in `europe-west1`, and that the trigger services grant
      `run.invoker` only to that account.
- [ ] Configure App Check (reCAPTCHA Enterprise) in monitoring mode; enforce only after the metrics
      show verified traffic, one service at a time.
- [ ] Uninstall the Firebase GitHub App installation `163487612` from the `asad200-stack` GitHub
      account if no other project uses it (it was created for the removed `viv` backend).
