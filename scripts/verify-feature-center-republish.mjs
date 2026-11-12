const AUTH = 'http://127.0.0.1:19309/identitytoolkit.googleapis.com/v1';
const FN = 'http://127.0.0.1:15311/demo-zelvero-featurecenter/europe-west1';
const PASS = 'Feature-verify-pass-1';
async function token(email) {
  const session = await fetch(`${AUTH}/accounts:signInWithPassword?key=demo-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS, returnSecureToken: true }),
  }).then((response) => response.json());
  return session;
}
const admin = await token('feature-admin@example.test');
const owner = await token('owner-a@example.test');
const response = await fetch(`${FN}/publishFeature`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.idToken}` },
  body: JSON.stringify({
    data: {
      featureId: 'verify_shelf_note',
      confirmPublication: true,
      confirmAllEligible: false,
      allEligible: false,
      tenantIds: [owner.localId],
    },
  }),
});
console.log(response.status, JSON.stringify(await response.json()));
