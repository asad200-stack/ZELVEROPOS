import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import { assertBenchProject, PROJECT_ID } from './phase-i-config.mjs';

assertBenchProject();

const require = createRequire(new URL('../../functions/package.json', import.meta.url));
require.resolve('firebase-admin');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

export { db, PROJECT_ID };
