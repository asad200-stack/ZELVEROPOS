# ZELVERO marketing website

Isolated Vite app in `apps/marketing/`. It never loads tenant Firestore, POS IndexedDB, or store financial data.

## Local

```
npm --prefix apps/marketing run dev
```

Preview: http://localhost:5174 (Vite default in this folder).

## Staging plan (not executed until owner approval)

1. Create a **new** Hosting site (suggested: `zelvero-web-staging`) — do **not** overwrite `zelvoropos` or `zelvoropos-staging` POS trees.
2. Build `npm --prefix apps/marketing run build`.
3. Deploy **only** that marketing staging site.
4. Owner review on staging URL.
5. Production marketing domain (future `zelvero.com`) only after explicit approval.

Do not deploy this app to https://zelvoropos.web.app.

## Funnel architecture (mocked in V1)

- Referral `?ref=CODE` → `localStorage` `zelvero.web.ref`
- Events buffered in-memory (`hero_trial_click`, `demo_open`, `quote_start`, `quote_complete`, `ai_open`, `ai_lead`, `partner_apply`) — no third-party analytics
- Trial and quote forms store locally only
- CRM pipeline planned: NEW → CONTACTED → DEMO → TRIAL → QUOTE → WON | LOST
- Partner portal planned: leads/trials/quotes/commission — never POS data
