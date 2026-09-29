import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { assertIsolatedProject } from './guard.js';

assertIsolatedProject();

if (!getApps().length) initializeApp();

export const db = getFirestore();
export const auth = getAuth();
export const storage = () => getStorage().bucket();
