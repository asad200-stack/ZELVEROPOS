# Repository layout

Verified 24 October 2026. The POS stays at the repository root. There is no `packages/` workspace:
the POS and Cloud Functions share business rules by copying files at Functions build time, and the
marketing site shares no source with either of them.

| Path | Owner | Depends on | Deploy target |
| --- | --- | --- | --- |
| `/` (`src/`, `public/`, `index.html`, `vite.config.ts`, `tsconfig*.json`, root `.env.*`) | ZELVERO POS app (Vite, React, TypeScript, Firebase SDK) | `config/firebase-isolation.json`, `tools/serviceWorkerPlugin.ts` | `hosting:production` publishes `dist/`. `hosting:staging` publishes `release-dist/` |
| `apps/marketing/` | Public ZELVERO website. Own `package.json`, lockfile and `node_modules`. No imports outside this folder | Calls `submitWebsiteLead` and `provisionWebsiteTrial` over HTTPS | Production `hosting:marketing` publishes `apps/marketing/dist` to `zelvero-web-staging`. Staging `hosting:web-staging` publishes `apps/marketing/staging-dist` to `zelvoropos-stage-web` |
| `functions/` | Cloud Functions (Node 22): accounts, claims, sub-users, super admin, website sales, releases, POS writes, Telegram | Build copies the domain files below into `functions/src/shared/` (generated, gitignored) and copies `config/firebase-isolation.json` | `functions` on project `zelvoropos` |
| `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `firebase.json`, `.firebaserc` | Firebase project config. Default project `zelvoropos` | — | rules, indexes, storage, hosting |
| `config/firebase-isolation.json` | Blocked-project list | Read by Vite, the POS runtime, `scripts/firebase-guard.mjs` and Functions | — |
| `tests/` | POS unit, rules, integration, concurrency and e2e suites (emulator project `demo-zelvero`) | `src/` and, in unit tests, `functions/src/` | — |
| `scripts/` | Guarded deploy, release assembly, emulator, migration and POS verification | `firebase.json`, root `.env*`, `functions/src/config.ts` | — |
| `tools/` | Vite service-worker plugin for the POS | — | — |
| `docs/` | Audit, release, infrastructure and website notes | — | — |
| `docs/awakening/` | Local cinematic workspace. Gitignored. Files stay on disk | — | — |
| `legacy/` | Read-only archive of the previous POS (tracked) | Nothing in the current apps | — |

`functions/scripts/copy-shared.mjs` copies these POS files, rewrites `@/` imports, and requires the
domain code to stay framework-free:

`src/domain/searchKey.ts`, `money.ts`, `pricing.ts`, `cart.ts`, `checkout.ts`, `returns.ts`,
`inventory.ts`, `suppliers.ts`, `release.ts`, `src/types/models.ts`, `src/constants/permissions.ts`.

`functions/src/permissions.ts` is a separate hand-maintained copy. `tests/unit/functions.test.ts`
checks it against `src/constants/permissions.ts`.

The POS stays at the repository root because production hosting (`dist`), the release assembler,
the Firebase guard, the Functions shared-code copy and the test configs all resolve paths from the
root. Moving it to `apps/pos/` changes the production hosting `public` path and is not part of the
current layout.

Root ESLint covers `src`, `tests`, `tools`, root TypeScript, `functions/src` and `scripts`. It does
not lint `apps/marketing`.

## Hosting

POS Hosting stays on project `zelvoropos`. Customer Marketing uses a separate target from the isolated staging site:

| Project | Target | Site | Public folder |
| --- | --- | --- | --- |
| `zelvoropos` | `production` | `zelvoropos` | `dist` |
| `zelvoropos` | `staging` | `zelvoropos-staging` | `release-dist` |
| `zelvoropos` | `marketing` | `zelvero-web-staging` | `apps/marketing/dist` |
| `zelvoropos-stage` | `staging` | `zelvoropos-stage` | `release-dist` |
| `zelvoropos-stage` | `web-staging` | `zelvoropos-stage-web` | `apps/marketing/staging-dist` |

`zelvoropos` has no `web-staging` target, so a production deploy cannot publish `staging-dist`. `zelvoropos-stage` has no `marketing` target, so a staging deploy cannot publish the production marketing bundle.

## Commands

| Task | Command | What it builds and where it deploys |
| --- | --- | --- |
| POS dev | `npm run dev` (emulators: `npm run dev:emulators`) | Vite only. `predev` runs `scripts/fix-encoding.cjs` |
| POS build | `npm run build` | `tsc -b` and Vite production mode into `dist/`. `prebuild` runs the encoding repair |
| POS staging build | `npm run build:staging` | Vite `--mode staging` into `staging-dist/`. Requires `stagingProjectId` and `.env.staging`. Does not deploy |
| POS checks | `npm run typecheck`, `npm run lint`, `npm test` | No deploy |
| POS emulator suites | `npm run test:rules`, `test:integration`, `test:concurrency`, `test:e2e` | Emulator project `demo-zelvero` only |
| POS staging | `npm run deploy:staging` | `scripts/assemble-release.mjs`, then `hosting:staging`, `functions` and `firestore:rules` |
| POS production | `npm run deploy` | POS build into `dist/`, then `hosting:production`, Firestore rules and indexes, storage and functions |
| POS hosting only | `npm run deploy:hosting` | `hosting:production` |
| Functions only | `npm run deploy:functions` | `functions` |
| Rules only | `npm run deploy:rules` | Firestore rules, indexes and storage |
| Release tree | `npm run release:assemble` | Staging POS build into `release-dist/app/<version>/`. Rewrites the staging rewrites in `firebase.json`. Does not deploy |
| Functions check | `npm run functions:typecheck`, `npm run functions:build` | No deploy |
| Marketing dev | `npm run web:dev` | `apps/marketing` Vite only |
| Marketing build / test | `npm run web:build`, `npm run web:test` | Production mode into `apps/marketing/dist`. No deploy |
| Marketing staging build | `npm run web:build:staging` | Vite `--mode staging` into `apps/marketing/staging-dist`. Requires `stagingProjectId` and `apps/marketing/.env.staging`. Does not deploy |
| Customer Marketing | `npm run web:deploy` | Production marketing build into `apps/marketing/dist`, then `hosting:marketing` on `zelvoropos` only. Asks for the project id. Does not deploy POS, Functions, or rules |
| Marketing staging | `npm run web:deploy:staging` | Staging marketing build into `apps/marketing/staging-dist`, then `hosting:web-staging` on `zelvoropos-stage` only |
| Isolation check | `npm run firebase:verify` | Reads the root `.env*` files and `functions/src/config.ts`. No deploy |

Every deploy script runs `checkFirebaseTargets` and asks for the project id before deploying.
Production deploys (`npm run deploy`, `deploy:hosting`, `deploy:functions`, `deploy:rules`) are owner-only.

`scripts/fix-encoding.cjs` walks the repo during POS `predev` and `prebuild`. A repo-wide run skips
`apps/marketing/` and `docs/awakening/`. Passing either directory as an explicit argument still scans it.

## Staging and production

The published staging sites are still Hosting sites on production project `zelvoropos`. Local staging builds are a separate path and do not make those sites isolated.

- `npm run deploy:staging` and `npm run web:deploy:staging` target `zelvoropos-stage` only.
  They still ask for confirmation and deploy Hosting, and the POS command also deploys Functions and
  rules. Those commands were not run for this configuration change. They cannot select `zelvoropos`.
- `apps/marketing/.env.production` still names project `zelvoropos` (region `europe-west1`).
  Lead, quote, and trial forms call `salesTargetError` before `fetch` and refuse that project, so a
  local or newly built page does not submit. The sites already published at
  `zelvero-web-staging.web.app` and `zelvoropos-staging.web.app`, and the Cloud Functions revision
  already deployed, were not changed. They can still reach production until a separately approved release.
- `submitWebsiteLead` and `provisionWebsiteTrial` take the project id from `GCLOUD_PROJECT` or
  `FIREBASE_CONFIG`, and the sales mode from `platform/salesConfig` or `WEBSITE_SALES_MODE`. On
  `zelvoropos` they refuse known staging hosts and `@zelvero.test` before Auth creates or Firestore
  writes. A client project id or header cannot make a request safe. A caller that omits Origin can
  still submit a real lead when the mode allows it.
- `npm run build:staging` and `npm run web:build:staging` read only `.env.staging` and
  `apps/marketing/.env.staging`. Those files are gitignored and name `zelvoropos-stage`.
  A bundle that contains the production project id `zelvoropos` as its own token, the production
  Functions hostname, or the production Storage bucket is deleted. `zelvoropos-stage` is not that
  token. `npm run build` and `npm run web:build` still use the production env files.
- Staging deploys stay on the staging role. `.firebaserc` maps Hosting target `staging` to site
  `zelvoropos-stage` and `web-staging` to `zelvoropos-stage-web`, under project `zelvoropos-stage`
  only. The production project's sites are unchanged.
- The sites already published at `zelvero-web-staging.web.app` and `zelvoropos-staging.web.app`
  were not rebuilt or deployed by these commands. They are not isolated.
- `scripts/firebase-guard.mjs` checks the root `.env*` files for the POS. It reads
  `apps/marketing/.env.production` as a separate object during `npm run firebase:verify` and
  `npm run web:deploy:staging`. Marketing values are not copied into the POS environment, and the
  website file is not required to contain POS API keys. A missing marketing file fails those two
  commands. POS production deploy hooks do not require it.
- `scripts/assemble-release.mjs` rewrites the tracked `firebase.json` staging rewrites when it builds
  a versioned tree.

`stagingProjectId` is `zelvoropos-stage`. POS Hosting for that project is site `zelvoropos-stage`.
Marketing Hosting is site `zelvoropos-stage-web`. `.firebaserc` still defaults to `zelvoropos`.
Deploying these local settings needs a separate approval. The previously published sites are not isolated.
