# ZELVERO release management

**NO DIRECT PRODUCTION FEATURE RELEASE.** Product version `1.0.0` is **not frozen**.

## Environments

| Site | URL | Who |
|---|---|---|
| Production Hosting | https://zelvoropos.web.app | Current unversioned app until freeze |
| Staging Hosting | https://zelvoropos-staging.web.app | Candidate trees; TEST tenant only |

Same Firebase project (`zelvoropos`). Functions and rules are shared; Hosting is not. Do not use techstore01, pos-catch, or customer stores for pre-release UI checks.

## Boot mapping

Staging root `index.html` has `data-release-boot="1"`. `boot.js` then:

1. Always applies language/theme.
2. If the path is already `/app/{version}/…`, it does nothing (the versioned SPA loads).
3. If signed-out / first visit / no tenant: `/release.json` `defaultVersion` (or `zelvero.lastGoodVersion` offline).
4. Redirects `/pos` → `/app/{version}/pos`, `/settings` → `/app/{version}/settings`, `/auth/action?…` keeps the query.

Production Hosting **omits** `data-release-boot`, so existing stores keep today’s `/pos` app. No tenant is moved by deploying this infrastructure.

After login, `getMyReleaseAssignment` resolves **store/tenant** assignment only. Cashiers in one store always share one version.

## Internal preview → customer release

1. `npm run deploy:staging` publishes the candidate tree to the staging site only. Production Hosting is untouched.
2. In Platform admin → Release Management, assign the candidate version to the internal demo store (badge "Internal demo") only.
3. Test on the staging site signed in as the platform admin; the demo store's data is separate from every customer store.
4. Customer release is a separate step. `npm run deploy` / `npm run deploy:hosting` include `hosting:production` and ask for `RELEASE TO CUSTOMERS` after the project id.

Functions and rules are shared by both sites: deploying them changes behaviour for customers immediately, whatever the Hosting site. A super-admin-only UI flag does not isolate a newly deployed SPA.

## Status

`draft` → `testing` → `ready` → `pilot` → `released`  
also `paused`, `rolled_back`.  
`draft` cannot go to everyone. Emergency requires typed `EMERGENCY RELEASE {v} TO EVERYONE` plus a reason.

## Retention

A tree may be deleted only if `checkReleaseTreeRetention` says it is unused: not assigned, not production, not previous, not min-supported, not staging, not a rollback target.
