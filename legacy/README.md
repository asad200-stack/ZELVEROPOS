# Legacy CATCH POS (read-only reference)

This folder holds the original vanilla-JS POS that ZELVERO POS replaces. It is kept only as a
behavioural reference during the migration and is scheduled for removal once the React app
covers every workflow.

It is **disconnected from Firebase on purpose**:

- `.firebaserc`, `firebase.json`, `package.json` and the deploy script were deleted, so the Firebase
  CLI cannot deploy from here.
- `public/firebase-config.js` was replaced with a stub that throws instead of initialising the
  old production project.

The untouched original is preserved in git history under the tag `legacy-baseline`.
Never restore the old Firebase configuration into the new application.
