#!/usr/bin/env node
/**
 * Verifies the DEPLOYED Cloud Functions of a real project against the built source:
 * the same function set, region, runtime service account, instance limits, Firestore trigger
 * configuration and the Cloud Run invoker of every service.
 *   npm --prefix functions run build && node scripts/verify/functions-live.mjs zelvoropos
 * Callables must be invocable by allUsers (Firebase Auth is enforced in the code); Firestore trigger
 * services must be invocable ONLY by the runtime account (firebase-tools does not grant this for
 * event triggers, so a new trigger needs a manual grant after its first deploy).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { checkFirebaseTargets } from '../firebase-guard.mjs';

const project = process.argv[2];
const { problems: guard, active } = checkFirebaseTargets();
if (guard.length || project !== active) {
  console.error('Blocked by the Firebase isolation guard:', guard.join('; ') || `${project} is not the configured project`);
  process.exit(1);
}

const config = readFileSync('functions/src/config.ts', 'utf8');
const constant = (name) => config.match(new RegExp(`export const ${name} = '([^']+)'`))?.[1];
const region = constant('REGION');
const runtime = `${constant('RUNTIME_SERVICE_ACCOUNT').replace(/@$/, '')}@${project}.iam.gserviceaccount.com`;
const FIRESTORE_LOCATION = 'eur3';

const source = await import(pathToFileURL('functions/lib/index.js').href);
const expected = new Map(Object.entries(source).filter(([, f]) => f?.__endpoint).map(([name, f]) => [name, f.__endpoint]));

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const get = async (url) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': project } });
  const json = await res.json();
  if (!res.ok) throw new Error(`${url}: ${res.status} ${JSON.stringify(json.error)}`);
  return json;
};

const deployed = [];
let pageToken = '';
do {
  const page = await get(`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/-/functions?pageSize=100${pageToken && `&pageToken=${pageToken}`}`);
  deployed.push(...(page.functions ?? []));
  pageToken = page.nextPageToken ?? '';
} while (pageToken);

const problems = [];
const seen = new Set();
for (const fn of deployed) {
  const [, , , location, , id] = fn.name.split('/');
  const label = `${id} (${location})`;
  const ep = expected.get(id);
  seen.add(id);
  if (!ep) { problems.push(`${label}: deployed but not in the source`); continue; }
  if (location !== region) problems.push(`${label}: region is not ${region}`);
  if (fn.state !== 'ACTIVE') problems.push(`${label}: state ${fn.state}`);
  if (fn.environment !== 'GEN_2') problems.push(`${label}: environment ${fn.environment}`);
  if (fn.serviceConfig?.serviceAccountEmail !== runtime) problems.push(`${label}: runs as ${fn.serviceConfig?.serviceAccountEmail}`);
  if (!fn.serviceConfig?.maxInstanceCount) problems.push(`${label}: no instance limit`);

  if (ep.eventTrigger) {
    const t = fn.eventTrigger;
    if (!t) { problems.push(`${label}: Firestore trigger missing`); continue; }
    if (t.eventType !== ep.eventTrigger.eventType) problems.push(`${label}: event type ${t.eventType}`);
    if (t.triggerRegion !== FIRESTORE_LOCATION) problems.push(`${label}: trigger region ${t.triggerRegion}`);
    if (t.serviceAccountEmail !== runtime) problems.push(`${label}: trigger identity ${t.serviceAccountEmail}`);
    const doc = t.eventFilters?.find((f) => f.attribute === 'document')?.value;
    if (doc !== ep.eventTrigger.eventFilterPathPatterns?.document) problems.push(`${label}: document filter ${doc}`);
    const db = t.eventFilters?.find((f) => f.attribute === 'database')?.value;
    if (db !== '(default)') problems.push(`${label}: database filter ${db}`);
  } else if (fn.eventTrigger) {
    problems.push(`${label}: unexpected event trigger`);
  }

  const service = fn.serviceConfig?.service;
  if (!service) { problems.push(`${label}: no Cloud Run service`); continue; }
  const policy = await get(`https://run.googleapis.com/v2/${service}:getIamPolicy`);
  const invokers = (policy.bindings ?? []).filter((b) => b.role === 'roles/run.invoker').flatMap((b) => b.members).sort();
  const want = ep.eventTrigger ? [`serviceAccount:${runtime}`] : ['allUsers'];
  if (invokers.join(',') !== want.join(',')) problems.push(`${label}: run.invoker is [${invokers.join(', ')}], expected [${want.join(', ')}]`);
  const others = (policy.bindings ?? []).filter((b) => b.role !== 'roles/run.invoker');
  if (others.length) problems.push(`${label}: extra service bindings ${others.map((b) => b.role).join(', ')}`);
}
for (const name of expected.keys()) if (!seen.has(name)) problems.push(`${name}: in the source but not deployed`);

const triggers = [...expected.values()].filter((e) => e.eventTrigger).length;
if (problems.length) {
  console.error(`functions-live: ${problems.length} problem(s)`);
  problems.forEach((p) => console.error('  - ' + p));
  process.exit(1);
}
console.log(`functions-live: ${deployed.length} deployed = ${expected.size} in source (${expected.size - triggers} callables, ${triggers} Firestore triggers), `
  + `all ACTIVE in ${region}, running as ${runtime}, with instance limits; callables invocable by allUsers, `
  + `trigger services only by the runtime account; triggers in ${FIRESTORE_LOCATION} on (default)`);
