# Deployment Guide

## Environments

This project uses two Firebase Hosting targets:

- 	est -- test / preview environment. All code changes must be deployed here first.
- prod -- production environment. Only deploy here after validation on 	est.

The backend (Cloud Functions, Firestore rules, Storage rules) is shared between both sites. If you need to change backend code, it affects both environments, so test backend changes carefully.

## Initial setup (one-time)

1. Create the test hosting site in your Firebase project:

   `ash
   firebase hosting:sites:create pos-catch-test
   firebase target:apply hosting test pos-catch-test
   firebase target:apply hosting prod pos-catch
   ``n
2. Verify the targets:

   `ash
   firebase target
   ``n
## Deploy commands

`ash
# Deploy to TEST only (default, recommended)
npm run deploy
# or
npm run deploy:test

# Deploy to PRODUCTION (requires explicit confirmation)
npm run deploy:prod

# Deploy backend services only (functions, rules, indexes)
npm run deploy:backend
``n
## Policy

1. **Any frontend change must be deployed to TEST first.**
2. **Production deployment requires double confirmation** and is intentionally guarded in scripts/deploy.js.
3. **Backend changes** are shared, so deploy them only when ready and after testing on the test site.

## Update rollout

App updates are released using semantic versioning (e.g. 1.0.0).

### From the Super Admin panel

- Choose the new version label (e.g. 1.0.1).
- Choose rollout mode:
  - **All users** -- global rollout.
  - **Selected users** -- targeted rollout; pick the users/owners from the modal.
- Click **Release Update** to prepare and release immediately, or **Mark Current Build** to prepare only.

### From the TEST POS

- Log in with the test account (sad28486@gmail.com) on the test site.
- A button **Update to All Users** appears in Settings -> App Update.
- Clicking it publishes the prepared update (global or targeted, depending on the rollout set by the admin).
- This button is hidden on production and for any other account.

## Test environment indicator

When the app is loaded from the test site, a red **TEST** badge appears in the header. If you do not see the badge, you are not on the test environment.

