# Zelvero POS — Working Notes for Claude Code

Production multi-tenant SaaS (Firebase project `zelvoropos`) with real customers.
This is live infrastructure, not a sandbox — read the Safety Rules before touching
anything under `functions/`, `firestore.rules`, `storage.rules`, `firebase*.json`,
or any `scripts/deploy*` / `*.cmd` deploy launcher.

## Stack

- Frontend: React 19 + TypeScript 6 (strict) + Vite 8, path alias `@/*` → `src/*`
- Backend: Firebase Cloud Functions v2 (`onCall`, region `europe-west1`, Node 22)
- Data: Firestore + Storage, validated with Zod 4 (`z.strictObject` — no extra client fields)
- Tests: Vitest — separate configs for unit, integration, e2e, rules, concurrency
- Auth pattern: every sensitive callable re-resolves the caller from live Auth + Firestore
  on every call (see `functions/src/aiCopilot.ts` → `resolveAiPrincipal` as the canonical example).
  Never trust a client-supplied tenant/store/uid field.

## Common commands

```
npm run dev                 # local dev server
npm run typecheck           # tsc -b --noEmit (frontend + node + sw projects)
npm run lint                # eslint .
npm run test                # vitest run (unit)
npm run test:integration    # emulator-backed integration suite (demo-zelvero project)
npm run test:rules          # firestore/storage rules tests
npm run emulators           # start firebase emulators against demo-zelvero
npm run functions:build     # build functions/ TypeScript
npm run functions:typecheck
npm run ai:knowledge:check  # verify AI knowledge-index draft matches reviewed approval file
```

Always run `node scripts/firebase-guard.mjs` (or let the npm script that wraps it run)
before any emulator or Firebase-touching command — it blocks accidental targeting of
the wrong Firebase project.

## Safety rules (non-negotiable)

- **Never run a deploy** (`npm run deploy*`, `firebase-tools deploy`, any `scripts/*deploy*.mjs`
  or `.cmd` launcher) without explicit, per-step user approval naming exactly what will be deployed.
  Never use a wildcard `--only functions` or `--only functions,functions` — always name exact
  function IDs (`--only functions:nameA,functions:nameB`).
- **Never modify customer data, billing, or Firestore/Storage rules** without explicit approval.
- **Never touch the three legacy AI functions** (`zelveroAiPlanTurn`, `zelveroAiStatus`,
  `resolveMyAiRollout`) — no delete, redeploy, or reconfigure — unless explicitly instructed.
- **Never auto-approve or publish AI knowledge-index diffs** (`src/features/ai/knowledge/draft.json`
  / `review.json`) — any fix to `ai:knowledge:check` failures needs a human-reviewed diff report first.
- Test against the `demo-zelvero` emulator stack, never against production (`zelvoropos`).
- Preserve uncommitted changes and existing branches (notably `backup/preview-security-2026-11-11`)
  unless told otherwise — do not run destructive git commands without explicit approval.
- When in doubt about blast radius, stop and ask rather than guessing.

## Conventions

- Strict TS: no `any` (`@typescript-eslint/no-explicit-any: error`), no unused vars/locals/params,
  `verbatimModuleSyntax`. Fix the type, don't suppress the rule.
- New callables follow the existing `onCall` + Zod `strictObject` input + explicit error codes pattern
  (`functions/src/errors.ts`). Read a neighboring function before adding a new one.
- Env config is split across `.env.production`, `.env.staging`, `.env.preview`, `.env.emulator`,
  `.env.feature-verify` — check which one a script actually loads before assuming values.
