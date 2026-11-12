// READ-ONLY production check: does each configured platform Super Admin already have a valid internal demo store?
// Uses the Firebase CLI's existing login. Only lookups/GETs. Writes a masked report to tmp/deploy/internal-demo-status.json.
const fs = require('fs'); const path = require('path');
const PROJECT = 'zelvoropos'; const SUB = 'zelvero-internal-demo';
const binDir = process.env.PATH.split(path.delimiter).find((p) => /_npx/i.test(p) && fs.existsSync(path.join(p, '..', 'firebase-tools', 'lib', 'apiv2.js')));
if (!binDir) { console.error('firebase-tools (npx) not found on PATH'); process.exit(2); }
const lib = path.join(binDir, '..', 'firebase-tools', 'lib');
const { Client } = require(path.join(lib, 'apiv2.js'));
const { requireAuth } = require(path.join(lib, 'requireAuth.js'));
const mask = (s) => (s ? String(s).slice(0, 4) + '…' + String(s).slice(-3) : s);
const val = (f) => (f == null ? undefined : 'booleanValue' in f ? f.booleanValue : 'stringValue' in f ? f.stringValue : 'integerValue' in f ? Number(f.integerValue) : 'timestampValue' in f ? f.timestampValue : 'nullValue' in f ? null : '(complex)');
(async () => {
  await requireAuth({ project: PROJECT, projectId: PROJECT });
  const idt = new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com', apiVersion: 'v1', auth: true });
  const fsc = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1', auth: true });
  const getDoc = async (p) => { try { const r = await fsc.get(`/projects/${PROJECT}/databases/(default)/documents/${p}`, { headers: { 'x-goog-user-project': PROJECT } }); const f = r.body.fields || {}; return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, val(v)])); } catch (e) { if (e.status === 404 || /not found|NOT_FOUND|404/i.test(String(e.message))) return null; throw e; } };
  const env = fs.readFileSync(path.join(__dirname, '..', 'functions', '.env.zelvoropos'), 'utf8');
  const emails = ((env.match(/^SUPER_ADMIN_EMAILS=(.*)$/m) || [])[1] || '').replace(/["']/g, '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const report = { checkedAt: new Date().toISOString(), project: PROJECT, configuredSuperAdmins: emails.length, accounts: [] };
  const subdomain = await getDoc(`storeSubdomains/${SUB}`);
  report.internalDemoSubdomain = subdomain ? { exists: true, tenantId: mask(subdomain.tenantId) } : { exists: false };
  for (const email of emails) {
    const r = await idt.post(`/projects/${PROJECT}/accounts:lookup`, { email: [email] }, { headers: { 'x-goog-user-project': PROJECT } });
    const u = (r.body.users || [])[0];
    const a = { email: mask(email), authUser: !!u };
    if (u) {
      const uid = u.localId; const claims = u.customAttributes ? JSON.parse(u.customAttributes) : {};
      Object.assign(a, { uid: mask(uid), emailVerified: !!u.emailVerified, disabled: !!u.disabled,
        claims: { superAdmin: claims.superAdmin === true, tenantIdIsOwnUid: claims.tenantId === uid, hasTenantClaim: 'tenantId' in claims, role: claims.role, active: claims.active } });
      const [user, sub, tenant, store, cleanup] = await Promise.all([getDoc(`users/${uid}`), getDoc(`subscriptions/${uid}`), getDoc(`tenants/${uid}`), getDoc(`stores/${uid}`), getDoc(`platformStorageCleanup/${uid}`)]);
      a.userDoc = user ? { exists: true, internalDemo: user.internalDemo === true, tenantIdIsOwnUid: user.tenantId === uid, otherTenant: !!user.tenantId && user.tenantId !== uid, role: user.role, isActive: user.isActive, storeName: user.storeName } : { exists: false };
      a.subscriptionDoc = sub ? { exists: true, internalDemo: sub.internalDemo === true, activated: sub.activated, lifetime: sub.lifetime, trial: sub.trial } : { exists: false };
      a.tenantDoc = tenant ? { exists: true, internalDemo: tenant.internalDemo === true } : { exists: false };
      a.storeDoc = store ? { exists: true, internalDemo: store.internalDemo === true, subdomain: store.subdomain } : { exists: false };
      a.cleanupRecord = cleanup ? { exists: true, status: cleanup.status } : { exists: false };
      a.subdomainOwnedByThisAccount = !!subdomain && subdomain.tenantId === uid;
      const ready = a.userDoc.internalDemo && a.userDoc.tenantIdIsOwnUid && a.subscriptionDoc.internalDemo && a.claims.superAdmin && a.emailVerified;
      const blocked = !ready && (a.userDoc.exists || a.tenantDoc.exists || a.storeDoc.exists || a.subscriptionDoc.exists || (subdomain && !a.subdomainOwnedByThisAccount) || a.cleanupRecord.exists);
      a.verdict = ready ? (a.claims.tenantIdIsOwnUid ? 'READY' : 'READY_BUT_CLAIMS_STALE') : blocked ? 'PROVISION_WOULD_BE_REFUSED' : 'NOT_PROVISIONED';
    }
    report.accounts.push(a);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'tmp', 'deploy', 'internal-demo-status.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => { console.error('FAILED', e.status || '', e.message); process.exit(1); });
