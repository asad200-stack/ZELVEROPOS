/**
 * Cloud Functions for CATCH POS
 * Deploy: firebase deploy --only functions
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const hostingPromote = require('./hosting-promote');

admin.initializeApp();

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeStoreSubdomainFromName(storeNameLike) {
  const raw = normalizeSpaces(storeNameLike).toLowerCase();
  return raw
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '')
    .substring(0, 50);
}

function getBootstrapSuperAdminEmails() {
  const envValue = process.env.SUPER_ADMIN_BOOTSTRAP_EMAILS || '';
  const envEmails = envValue
    .split(',')
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
  return envEmails;
}

function hasSuperAdminClaim(tokenLike) {
  const claims = tokenLike || {};
  return claims.super_admin === true || claims.superAdmin === true;
}

function assertSuperAdminToken(tokenLike) {
  if (!hasSuperAdminClaim(tokenLike)) {
    throw new functions.https.HttpsError('permission-denied', 'Super admin claim required.');
  }
}

function assertBootstrapSuperAdminEmail(emailLike) {
  const email = normalizeEmail(emailLike);
  const allowlist = getBootstrapSuperAdminEmails();
  if (allowlist.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', 'SUPER_ADMIN_BOOTSTRAP_EMAILS is not configured.');
  }
  if (!allowlist.includes(email)) {
    throw new functions.https.HttpsError('permission-denied', 'Authorized super admin email required.');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function telegramFetchWithRetry({ url, init, maxAttempts = 4, attemptBaseDelayMs = 700, shouldRetry }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      const retry = typeof shouldRetry === 'function'
        ? shouldRetry({ res, data })
        : false;
      if (!retry) return { res, data };
      lastErr = new Error(`telegram transient failure (attempt ${attempt}/${maxAttempts})`);
      // Exponential backoff + small jitter
      const delay = Math.min(30000, attemptBaseDelayMs * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 250);
      await sleep(delay);
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const delay = Math.min(30000, attemptBaseDelayMs * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 250);
      await sleep(delay);
    }
  }
  throw lastErr || new Error('telegramFetchWithRetry failed');
}

/** Permanent account deletion logic: Super Admin only */
async function deleteAuthUserBySuperAdminLogic(callerUid, targetUid, callerToken) {
  if (callerUid === targetUid) {
    return { error: 'invalid-argument', message: 'Cannot delete your own Auth account from here.' };
  }
  try {
    assertSuperAdminToken(callerToken);
  } catch (error) {
    return { error: 'permission-denied', message: 'Only Super Admin can delete accounts.' };
  }
  const db = admin.firestore();
  const targetUidTrim = String(targetUid || '').trim();
  if (!targetUidTrim) {
    return { error: 'invalid-argument', message: 'Target uid is required.' };
  }
  try {
    // Firestore cleanup (best effort but explicit).
    const cleanupTasks = [
      db.collection('users').doc(targetUidTrim).delete().catch(() => null),
      db.collection('subscriptions').doc(targetUidTrim).delete().catch(() => null),
      db.collection('usageStats').doc(targetUidTrim).delete().catch(() => null),
      db.collection('userData').doc(targetUidTrim).delete().catch(() => null)
    ];
    await Promise.all(cleanupTasks);

    // Remove full tenant tree for owner account (if exists).
    try {
      await db.recursiveDelete(db.collection('userData').doc(targetUidTrim));
    } catch (cleanupErr) {
      console.warn('recursiveDelete userData failed (continuing):', targetUidTrim, cleanupErr && cleanupErr.message ? cleanupErr.message : cleanupErr);
    }

    // Finally remove Auth account.
    await admin.auth().deleteUser(targetUidTrim);
    return { success: true, deletedUid: targetUidTrim };
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      return { success: true, deletedUid: targetUidTrim };
    }
    return { error: 'internal', message: err.message || 'Failed to delete account.' };
  }
}

/**
 * Delete a Firebase Auth user (Super Admin only).
 * Request: POST + Authorization: Bearer <idToken> + body: { uid: "<targetUid>" }
 * Uses Express + cors for reliable CORS preflight handling.
 */
const deleteAuthUserBySuperAdminApp = express();
deleteAuthUserBySuperAdminApp.use(
  cors({
    origin: ['https://pos-catch.web.app', 'https://pos-catch.firebaseapp.com'],
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 3600,
  })
);
deleteAuthUserBySuperAdminApp.use(express.json());

deleteAuthUserBySuperAdminApp.post('/', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'unauthenticated', message: 'Missing or invalid Authorization header.' });
      return;
    }
    const idToken = authHeader.split('Bearer ')[1];
    if (!idToken) {
      res.status(401).json({ error: 'unauthenticated', message: 'Missing token.' });
      return;
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    await assertFeatureEnabledForPrincipal({
      uid: String((decoded && decoded.uid) || ''),
      ownerId: String((decoded && (decoded.ownerId || decoded.parentAdminId)) || ''),
      tenantId: String((decoded && decoded.tenantId) || ''),
      token: decoded || {}
    }, 'admin_delete_auth_user', true);
    const callerUid = decoded.uid;

    const targetUid = req.body && req.body.uid;
    if (!targetUid || typeof targetUid !== 'string') {
      res.status(400).json({ error: 'invalid-argument', message: 'Missing or invalid uid.' });
      return;
    }

    const result = await deleteAuthUserBySuperAdminLogic(callerUid, targetUid, decoded);
    if (result.error) {
      const code =
        result.error === 'permission-denied'
          ? 403
          : result.error === 'invalid-argument'
          ? 400
          : 500;
      res.status(code).json({ error: result.error, message: result.message });
      return;
    }

    res.status(200).json({ result: { success: true } });
  } catch (err) {
    if (err.code === 'auth/argument-error' || err.code === 'auth/id-token-expired') {
      res.status(401).json({ error: 'unauthenticated', message: err.message || 'Invalid or expired token.' });
      return;
    }
    console.error('deleteAuthUserBySuperAdmin error:', err);
    res.status(500).json({ error: 'internal', message: err.message || 'Server error.' });
  }
});

exports.deleteAuthUserBySuperAdmin = functions
  .region('us-central1')
  .https.onRequest(deleteAuthUserBySuperAdminApp);

/**
 * Create a sub-user — admin (store owner) only.
 * POST + Authorization: Bearer <idToken>
 * Body: { email, password, name, permissions: { canSell, canEditPrice, canViewSales, canViewProducts, ... } }
 */
function parseCreateSubUserBody(req) {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return req.body;
  }
  if (req.rawBody && Buffer.isBuffer(req.rawBody) && req.rawBody.length) {
    try {
      return JSON.parse(req.rawBody.toString('utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

const createSubUserApp = express();
createSubUserApp.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const fixed = new Set([
        'https://pos-catch.web.app',
        'https://pos-catch.firebaseapp.com',
        'http://localhost:5000',
        'http://127.0.0.1:5000',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
      ]);
      if (fixed.has(origin)) return callback(null, true);
      if (/^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/i.test(origin)) return callback(null, true);
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return callback(null, true);
      // Any other HTTPS (dedicated domain for hosting) — the request is protected with a Firebase ID token
      if (/^https:\/\//i.test(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 3600,
  })
);
createSubUserApp.use(express.json({ limit: '256kb' }));

createSubUserApp.post('/', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'unauthenticated', message: 'Missing or invalid Authorization header.' });
      return;
    }
    const idToken = authHeader.split('Bearer ')[1];
    if (!idToken) {
      res.status(401).json({ error: 'unauthenticated', message: 'Missing token.' });
      return;
    }
    const decoded = await admin.auth().verifyIdToken(idToken);
    await assertFeatureEnabledForPrincipal({
      uid: String((decoded && decoded.uid) || ''),
      ownerId: String((decoded && (decoded.ownerId || decoded.parentAdminId)) || ''),
      tenantId: String((decoded && decoded.tenantId) || ''),
      token: decoded || {}
    }, 'owner_create_sub_user', true);
    const callerUid = decoded.uid;

    const body = parseCreateSubUserBody(req);
    const { email, password, name, permissions } = body;
    if (!email || typeof email !== 'string' || !email.trim()) {
      res.status(400).json({ error: 'invalid-argument', message: 'Email is required.' });
      return;
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: 'invalid-argument', message: 'Password must be at least 6 characters.' });
      return;
    }
    const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
    if (!callerDoc.exists) {
      res.status(403).json({ error: 'permission-denied', message: 'User not found.' });
      return;
    }
    const callerData = callerDoc.data();
    if (callerData.parentAdminId) {
      res.status(403).json({ error: 'permission-denied', message: 'Only store owner (admin) can create sub-users.' });
      return;
    }

    const emailTrim = email.trim().toLowerCase();
    const nameTrim = (name && typeof name === 'string') ? name.trim() : emailTrim.split('@')[0];
    const defaultPerms = {
      canSell: true,
      canEditPrice: true,
      canViewSales: true,
      canViewProducts: true,
      canViewCustomers: true,
      canViewReports: true,
      canViewSuppliers: false,
      canManageCashDrawer: false,
    };
    const perms = (permissions && typeof permissions === 'object') ? { ...defaultPerms, ...permissions } : defaultPerms;
    const usersRef = admin.firestore().collection('users');
    let targetUid = null;
    let reusedExisting = false;

    // Handle duplicate email robustly:
    // - If email already exists and belongs to this admin's sub-user, reuse/update it.
    // - If an orphan Auth user exists without Firestore doc, adopt it as this admin sub-user.
    // - If it belongs to another real account, reject with clear message.
    try {
      const existingAuth = await admin.auth().getUserByEmail(emailTrim);
      if (existingAuth && existingAuth.uid) {
        const existingUid = existingAuth.uid;
        if (existingUid === callerUid) {
          res.status(400).json({ error: 'invalid-argument', message: 'You cannot use your own admin email for a sub-user.' });
          return;
        }

        const existingDocSnap = await usersRef.doc(existingUid).get();
        if (existingDocSnap.exists) {
          const existingData = existingDocSnap.data() || {};
          const sameAdminSubUser = existingData.role === 'subUser' && existingData.parentAdminId === callerUid;
          if (!sameAdminSubUser) {
            res.status(409).json({
              error: 'email-already-exists',
              message: 'This email is already linked to another account. Use a different email.',
            });
            return;
          }
        }

        // Reuse this auth user for the same admin sub-user (or adopt orphan auth record).
        await admin.auth().updateUser(existingUid, {
          password: password,
          emailVerified: true,
          displayName: nameTrim,
          disabled: false,
        });
        targetUid = existingUid;
        reusedExisting = true;
      }
    } catch (e) {
      if (!e || e.code !== 'auth/user-not-found') throw e;
    }

    if (!targetUid) {
      // New Auth user creation
      const userRecord = await admin.auth().createUser({
        email: emailTrim,
        password: password,
        emailVerified: true,
        displayName: nameTrim,
      });
      targetUid = userRecord.uid;
    }

    const userDocPayload = {
      uid: targetUid,
      fullName: nameTrim,
      name: nameTrim,
      email: emailTrim,
      role: 'subUser',
      parentAdminId: callerUid,
      permissions: perms,
      isActive: true,
      storeName: callerData.storeName || '',
      subdomain: callerData.subdomain || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await usersRef.doc(targetUid).set(userDocPayload, { merge: true });

    res.status(200).json({
      success: true,
      reused: reusedExisting,
      subUserId: targetUid,
      email: emailTrim,
      name: nameTrim,
    });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      res.status(400).json({ error: 'email-already-exists', message: 'This email is already used.' });
      return;
    }
    if (err.code === 'auth/invalid-email') {
      res.status(400).json({ error: 'invalid-email', message: 'Invalid email address.' });
      return;
    }
    if (err.code === 'auth/weak-password' || err.code === 'auth/invalid-password') {
      res.status(400).json({
        error: err.code,
        message: 'Password is too weak. Use at least 6 characters with letters and numbers.',
      });
      return;
    }
    if (err.code === 'auth/operation-not-allowed') {
      res.status(400).json({
        error: 'operation-not-allowed',
        message: 'Email/Password sign-in is disabled in Firebase Console (Authentication → Sign-in method).',
      });
      return;
    }
    if (err.code === 'auth/argument-error' || err.code === 'auth/id-token-expired') {
      res.status(401).json({ error: 'unauthenticated', message: err.message || 'Invalid or expired token.' });
      return;
    }
    console.error('createSubUser error:', err);
    res.status(500).json({ error: 'internal', message: err.message || 'Failed to create sub-user.' });
  }
});

exports.createSubUser = functions
  .region('us-central1')
  .https.onRequest(createSubUserApp);

/**
 * Telegram send proxy (the browser cannot call api.telegram.org directly due to CORS).
 * POST + Authorization: Bearer <Firebase idToken>
 * Body: { botToken, chatId, text }
 */
const TELEGRAM_ALLOWED_ORIGINS = new Set([
  'https://pos-catch.web.app',
  'https://pos-catch.firebaseapp.com',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]);

function parseRequestJsonBody(req) {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return req.body;
  }
  if (req.rawBody && Buffer.isBuffer(req.rawBody) && req.rawBody.length) {
    try {
      return JSON.parse(req.rawBody.toString('utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

function getConfiguredTelegramBotToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

async function resolveTelegramBotToken(body, decodedToken) {
  const decoded = decodedToken || {};
  const ownerId = String(
    decoded.ownerId ||
    decoded.parentAdminId ||
    decoded.uid ||
    ''
  ).trim();

  // Per-owner saved settings (each subscriber uses their own bot).
  if (ownerId) {
    try {
      const settings = await getOwnerSettings(ownerId);
      const savedToken = String((settings && settings.telegramBotToken) || '').trim();
      if (savedToken) return savedToken;
    } catch (_) {}
  }

  const configured = getConfiguredTelegramBotToken();
  if (configured) return configured;

  const bodyToken = String((body && body.botToken) || '').trim();
  // Authenticated account owners may use their own bot token (multi-tenant).
  if (bodyToken && ownerId) return bodyToken;

  // Backward compatibility fallback for super admin sessions.
  if (hasSuperAdminClaim(decoded)) return bodyToken;

  return '';
}

exports.telegramSendMessage = functions
  .region('us-central1')
  .https.onRequest(async (req, res) => {
    const requestId = req.get('x-request-id') || req.get('x-cloud-trace-context') || `tgmsg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const origin = req.headers.origin || '';
    const allowFirebaseHost =
      /^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/i.test(origin);
    if (TELEGRAM_ALLOWED_ORIGINS.has(origin) || allowFirebaseHost) {
      res.set('Access-Control-Allow-Origin', origin || 'https://pos-catch.web.app');
    } else {
      res.set('Access-Control-Allow-Origin', 'https://pos-catch.web.app');
    }
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('[telegramSendMessage] unauthenticated request', { requestId, origin });
        res.status(401).json({ ok: false, error: 'unauthenticated', description: 'Bearer token required' });
        return;
      }
      const idToken = authHeader.split('Bearer ')[1];
      const decoded = await admin.auth().verifyIdToken(idToken);
      await assertFeatureEnabledForPrincipal({
        uid: String((decoded && decoded.uid) || ''),
        ownerId: String((decoded && (decoded.ownerId || decoded.parentAdminId)) || ''),
        tenantId: String((decoded && decoded.tenantId) || ''),
        token: decoded || {}
      }, 'telegram_proxy', true);

      const body = parseRequestJsonBody(req);
      const botToken = await resolveTelegramBotToken(body, decoded);
      let chatId = body.chatId;
      const text = String(body.text || '').trim();
      if (chatId !== undefined && chatId !== null) {
        chatId = String(chatId).trim().replace(/[^\d-]/g, '');
        if (/^-?\d+$/.test(chatId)) {
          chatId = Number(chatId);
        }
      }
      if (!botToken || chatId === undefined || chatId === null || chatId === '') {
        console.error('telegramSendMessage missing fields', {
          hasToken: !!botToken,
          chatId: body.chatId,
        });
        res.status(400).json({
          ok: false,
          error: 'missing botToken or chatId',
          description: 'Save your Bot Token in Telegram settings, or configure TELEGRAM_BOT_TOKEN on the server.',
        });
        return;
      }
      if (!text || text.length > 4090) {
        res.status(400).json({ ok: false, error: 'invalid text' });
        return;
      }

      const tgUrl = 'https://api.telegram.org/bot' + botToken + '/sendMessage';
      console.log('[telegramSendMessage] request accepted', {
        requestId,
        origin,
        hasChatId: chatId !== undefined && chatId !== null && String(chatId).length > 0,
        textLen: String(text || '').length,
      });

      const { res: tgRes, data } = await telegramFetchWithRetry({
        url: tgUrl,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: true,
          }),
        },
        maxAttempts: 4,
        attemptBaseDelayMs: 800,
        shouldRetry: ({ res: r, data: d }) => {
          const status = r && r.status ? r.status : 0;
          const errCode = d && d.error_code;
          // Retry only transient issues (network/5xx/429)
          if (status === 429) return true;
          if (errCode === 429) return true;
          if (status >= 500) return true;
          if (status === 408) return true;
          return false;
        }
      });

      if (data && data.ok) {
        res.status(200).json({ ok: true });
      } else {
        console.error('[telegramSendMessage] telegram API failed', {
          requestId,
          status: tgRes && tgRes.status,
          description: data && (data.description || data.error),
          error_code: data && data.error_code,
        });
        res.status(200).json({
          ok: false,
          description: (data && (data.description || data.error)) || 'telegram_api_error',
        });
      }
    } catch (err) {
      console.error('telegramSendMessage', err);
      if (err.code === 'auth/argument-error' || err.code === 'auth/id-token-expired') {
        res.status(401).json({ ok: false, error: 'unauthenticated', description: err.message });
        return;
      }
      res.status(500).json({ ok: false, error: err.message || 'internal' });
    }
  });

/**
 * Send a file (e.g. backup) to Telegram.
 * POST + Authorization: Bearer <idToken>
 * Body: { botToken, chatId, documentBase64, filename }
 * Files larger than 50MB are rejected by Telegram.
 */
const FormData = require('form-data');

exports.telegramSendDocument = functions
  .region('us-central1')
  .https.onRequest(async (req, res) => {
    const requestId = req.get('x-request-id') || req.get('x-cloud-trace-context') || `tgd_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const origin = req.headers.origin || '';
    const allowFirebaseHost =
      /^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/i.test(origin);
    if (TELEGRAM_ALLOWED_ORIGINS.has(origin) || allowFirebaseHost) {
      res.set('Access-Control-Allow-Origin', origin || 'https://pos-catch.web.app');
    } else {
      res.set('Access-Control-Allow-Origin', 'https://pos-catch.web.app');
    }
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('[telegramSendDocument] unauthenticated request', { requestId, origin });
        res.status(401).json({ ok: false, error: 'unauthenticated', description: 'Bearer token required' });
        return;
      }
      const idToken = authHeader.split('Bearer ')[1];
      const decoded = await admin.auth().verifyIdToken(idToken);
      await assertFeatureEnabledForPrincipal({
        uid: String((decoded && decoded.uid) || ''),
        ownerId: String((decoded && (decoded.ownerId || decoded.parentAdminId)) || ''),
        tenantId: String((decoded && decoded.tenantId) || ''),
        token: decoded || {}
      }, 'telegram_proxy', true);

      const body = parseRequestJsonBody(req);
      const botToken = await resolveTelegramBotToken(body, decoded);
      let chatId = body.chatId;
      const documentBase64 = body.documentBase64;
      const filename = String(body.filename || 'backup.json').trim().replace(/[^\w.\-]/g, '_') || 'backup.json';

      if (chatId !== undefined && chatId !== null) {
        chatId = String(chatId).trim().replace(/[^\d-]/g, '');
        if (/^-?\d+$/.test(chatId)) chatId = Number(chatId);
      }
      if (!botToken || chatId === undefined || chatId === null || chatId === '') {
        res.status(400).json({ ok: false, error: 'missing botToken or chatId' });
        return;
      }
      if (!documentBase64 || typeof documentBase64 !== 'string') {
        res.status(400).json({ ok: false, error: 'missing documentBase64' });
        return;
      }

      const buf = Buffer.from(documentBase64, 'base64');
      if (buf.length > 50 * 1024 * 1024) {
        res.status(400).json({ ok: false, error: 'file_too_large', description: 'Telegram max document size is 50MB' });
        return;
      }

      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('document', buf, { filename: filename });

      const tgUrl = 'https://api.telegram.org/bot' + botToken + '/sendDocument';
      console.log('[telegramSendDocument] request accepted', {
        requestId,
        origin,
        hasChatId: chatId !== undefined && chatId !== null && String(chatId).length > 0,
        filename: filename,
        bytes: buf && buf.length ? buf.length : null
      });

      const { res: tgRes, data } = await telegramFetchWithRetry({
        url: tgUrl,
        init: {
          method: 'POST',
          headers: form.getHeaders(),
          body: form,
        },
        maxAttempts: 3,
        attemptBaseDelayMs: 1000,
        shouldRetry: ({ res: r, data: d }) => {
          const status = r && r.status ? r.status : 0;
          const errCode = d && d.error_code;
          if (status === 429) return true;
          if (errCode === 429) return true;
          if (status >= 500) return true;
          if (status === 408) return true;
          return false;
        }
      });

      if (data && data.ok) {
        res.status(200).json({ ok: true });
      } else {
        console.error('[telegramSendDocument] telegram API failed', {
          requestId,
          status: tgRes && tgRes.status,
          description: data && (data.description || data.error),
          error_code: data && data.error_code,
        });
        res.status(200).json({
          ok: false,
          description: (data && (data.description || data.error)) || 'telegram_sendDocument_error',
        });
      }
    } catch (err) {
      console.error('telegramSendDocument', err);
      if (err.code === 'auth/argument-error' || err.code === 'auth/id-token-expired') {
        res.status(401).json({ ok: false, error: 'unauthenticated', description: err.message });
        return;
      }
      res.status(500).json({ ok: false, error: err.message || 'internal' });
    }
  });

function assertSuperAdminCallable(context) {
  if (!context || !context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }
  assertSuperAdminToken(context.auth.token || {});
}

function assertAuthenticatedCallable(context) {
  if (!context || !context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }
}

// ============ FEATURE FLAGS (CENTRAL RESOLVER + CACHE) ============
const FEATURE_FLAGS_CACHE_TTL_MS = 60 * 1000; // 1 min server-side cache
let __featureFlagsCache = { at: 0, data: {} };
const APP_UPDATE_CACHE_TTL_MS = 30 * 1000;
let __appUpdateCache = { at: 0, data: {} };

async function getFeatureFlagsDocCached(force = false) {
  const now = Date.now();
  if (!force && __featureFlagsCache.data && (now - __featureFlagsCache.at) < FEATURE_FLAGS_CACHE_TTL_MS) {
    return __featureFlagsCache.data;
  }
  const snap = await admin.firestore().collection('appControl').doc('features').get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const flags = (data && typeof data.featureFlags === 'object' && data.featureFlags) ? data.featureFlags : {};
  __featureFlagsCache = { at: now, data: flags };
  return flags;
}

async function getAppUpdateControlCached(force = false) {
  const now = Date.now();
  if (!force && __appUpdateCache.data && (now - __appUpdateCache.at) < APP_UPDATE_CACHE_TTL_MS) {
    return __appUpdateCache.data;
  }
  const snap = await admin.firestore().collection('appControl').doc('update').get();
  const data = snap.exists ? (snap.data() || {}) : {};
  __appUpdateCache = { at: now, data };
  return data;
}

async function getPrincipalScopeFromAuth(context) {
  assertAuthenticatedCallable(context);
  const uid = String(context.auth.uid || '').trim();
  const token = (context.auth && context.auth.token) ? context.auth.token : {};
  let ownerId = '';
  let tenantId = '';
  let userPlan = '';
  let branchId = '';
  try {
    const userSnap = await admin.firestore().collection('users').doc(uid).get();
    const user = userSnap.exists ? (userSnap.data() || {}) : {};
    ownerId = String(
      user.parentAdminId ||
      user.parentAdminID ||
      user.parentId ||
      user.parentUid ||
      user.ownerId ||
      user.ownerUid ||
      uid
    ).trim();
    tenantId = String(
      user.tenantId ||
      user.tenantID ||
      user.tenant ||
      user.storeId ||
      ownerId
    ).trim();
    userPlan = String(
      user.plan ||
      user.subscriptionPlan ||
      user.planId ||
      user.pricingPlan ||
      ''
    ).trim().toLowerCase();
    branchId = String(
      user.branchId ||
      user.branch ||
      user.storeBranch ||
      user.storeBranchId ||
      ''
    ).trim().toLowerCase();
  } catch (_) {
    ownerId = uid;
    tenantId = uid;
    userPlan = '';
    branchId = '';
  }
  return {
    uid,
    ownerId: ownerId || uid,
    tenantId: tenantId || ownerId || uid,
    userPlan,
    branchId,
    token
  };
}

function normalizeFlagRule(rule) {
  if (rule == null) return {};
  if (typeof rule === 'boolean') return { mode: rule ? 'global' : 'off' };
  if (typeof rule !== 'object') return { mode: 'off' };
  return rule;
}

function resolveFlagForPrincipal(ruleRaw, principal, fallback = false) {
  const rule = normalizeFlagRule(ruleRaw);
  const mode = String(rule.mode || '').toLowerCase();
  if (mode === 'off') return false;
  if (mode === 'global' || mode === 'all' || mode === 'on') return true;
  if (mode === 'super_admin_only') return hasSuperAdminClaim((principal && principal.token) || {});

  const list = (v) => Array.isArray(v) ? v.map(x => String(x || '').trim()).filter(Boolean) : [];
  const userIds = list(rule.userIds || rule.allowUids || rule.allowedUsers);
  const ownerIds = list(rule.ownerIds || rule.allowOwnerIds || rule.allowedOwners);
  const tenantIds = list(rule.tenantIds || rule.allowTenantIds || rule.allowedTenants);
  const uid = String((principal && principal.uid) || '');
  const ownerId = String((principal && principal.ownerId) || '');
  const tenantId = String((principal && principal.tenantId) || '');

  if (mode === 'allow_list' || mode === 'targeted' || mode === 'selected') {
    return userIds.includes(uid) || ownerIds.includes(ownerId) || tenantIds.includes(tenantId);
  }
  if (mode === 'owner_only') return ownerIds.includes(ownerId);
  if (mode === 'tenant_only') return tenantIds.includes(tenantId);
  if (mode === 'user_only') return userIds.includes(uid);

  const enabled = !!rule.enabled;
  if (!enabled) return !!fallback;
  const hasScopes = userIds.length || ownerIds.length || tenantIds.length;
  if (!hasScopes) return true;
  return userIds.includes(uid) || ownerIds.includes(ownerId) || tenantIds.includes(tenantId);
}

function resolveDeploymentGateForPrincipal(updateControl, principal, currentVersionCode) {
  const released = Number(updateControl && updateControl.releasedVersionCode || 0) || 0;
  const current = Number(currentVersionCode || 0) || 0;
  const isSuperAdmin = hasSuperAdminClaim((principal && principal.token) || {});
  const isPreReleaseBuild = !!(current > 0 && released > 0 && current > released);
  const rolloutDecision = resolveReleasedVersionEligibility(updateControl, principal);
  const channelDecision = resolveChannelForPrincipal(updateControl, principal);
  const locked = isPreReleaseBuild && !isSuperAdmin;
  return {
    releasedVersionCode: released,
    currentVersionCode: current,
    isPreReleaseBuild,
    lockedForCurrentUser: locked,
    eligibleForReleasedVersion: !!rolloutDecision.eligible,
    rolloutReason: String(rolloutDecision.reason || ''),
    rollout: rolloutDecision.rollout,
    updateChannel: String(channelDecision.channel || 'stable'),
    channelReason: String(channelDecision.reason || ''),
    targetVersionCode: Number(channelDecision.targetVersionCode || 0) || 0,
    targetVersionLabel: String(channelDecision.targetVersionLabel || '')
  };
}

function parseIdList(valueLike) {
  return Array.isArray(valueLike)
    ? valueLike.map((v) => String(v || '').trim()).filter(Boolean)
    : [];
}

function stablePercentBucket(sourceLike) {
  const source = String(sourceLike || '').trim();
  if (!source) return 0;
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) - hash) + source.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash % 100);
}

function normalizeRolloutPolicy(policyRaw) {
  const policy = (policyRaw && typeof policyRaw === 'object') ? policyRaw : {};
  const rolloutPercent = Math.max(0, Math.min(100, Number(policy.rolloutPercent || 100) || 100));
  const startsAtMs = __tsToMillis(policy.startsAt || policy.rolloutStartsAt || policy.rolloutStartAt || 0);
  return {
    mode: String(policy.mode || 'global').trim().toLowerCase() || 'global',
    rolloutPercent,
    startsAtMs,
    userIds: parseIdList(policy.userIds || policy.allowUids || policy.allowedUsers),
    ownerIds: parseIdList(policy.ownerIds || policy.allowOwnerIds || policy.allowedOwners),
    tenantIds: parseIdList(policy.tenantIds || policy.allowTenantIds || policy.allowedTenants)
  };
}

function normalizeChannelSelectors(raw) {
  const selectors = (raw && typeof raw === 'object') ? raw : {};
  const parse = (value) => Array.isArray(value)
    ? value.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
    : [];
  return {
    userIds: parse(selectors.userIds || selectors.allowUserIds || selectors.uids),
    ownerIds: parse(selectors.ownerIds || selectors.allowOwnerIds),
    tenantIds: parse(selectors.tenantIds || selectors.allowTenantIds),
    plans: parse(selectors.plans || selectors.planIds || selectors.subscriptionPlans),
    branches: parse(selectors.branches || selectors.branchIds)
  };
}

function principalMatchesSelectors(principal, selectorsRaw) {
  const selectors = normalizeChannelSelectors(selectorsRaw);
  const uid = String((principal && principal.uid) || '').trim().toLowerCase();
  const ownerId = String((principal && principal.ownerId) || '').trim().toLowerCase();
  const tenantId = String((principal && principal.tenantId) || '').trim().toLowerCase();
  const userPlan = String((principal && principal.userPlan) || '').trim().toLowerCase();
  const branchId = String((principal && principal.branchId) || '').trim().toLowerCase();
  if (selectors.userIds.includes(uid)) return true;
  if (selectors.ownerIds.includes(ownerId)) return true;
  if (selectors.tenantIds.includes(tenantId)) return true;
  if (selectors.plans.length && userPlan && selectors.plans.includes(userPlan)) return true;
  if (selectors.branches.length && branchId && selectors.branches.includes(branchId)) return true;
  return false;
}

function resolveChannelForPrincipal(updateControl, principal) {
  const cfg = (updateControl && typeof updateControl === 'object') ? updateControl : {};
  if (cfg.updatePaused === true || cfg.emergencyStop === true) {
    return {
      channel: 'paused',
      reason: 'emergency_stop',
      targetVersionCode: Number(cfg.rollbackVersionCode || cfg.releasedVersionCode || 0) || 0,
      targetVersionLabel: String(cfg.rollbackVersionLabel || cfg.releasedVersionLabel || '').trim()
    };
  }
  const masterUids = parseIdList(cfg.masterAccountUids || cfg.internalAccountUids || cfg.masterDemoUids)
    .map((v) => String(v).toLowerCase());
  const uidLc = String((principal && principal.uid) || '').trim().toLowerCase();
  const internal = (cfg.channels && typeof cfg.channels.internal === 'object') ? cfg.channels.internal : {};
  const beta = (cfg.channels && typeof cfg.channels.beta === 'object') ? cfg.channels.beta : {};
  const stable = (cfg.channels && typeof cfg.channels.stable === 'object') ? cfg.channels.stable : {};
  if (masterUids.includes(uidLc)) {
    return {
      channel: 'internal',
      reason: 'master_account',
      targetVersionCode: Number(internal.versionCode || cfg.pendingVersionCode || cfg.releasedVersionCode || 0) || 0,
      targetVersionLabel: String(internal.versionLabel || cfg.pendingVersionLabel || cfg.releasedVersionLabel || '').trim()
    };
  }
  if (principalMatchesSelectors(principal, beta.selectors || cfg.betaSelectors || {})) {
    return {
      channel: 'beta',
      reason: 'beta_selectors',
      targetVersionCode: Number(beta.versionCode || cfg.pendingVersionCode || cfg.releasedVersionCode || 0) || 0,
      targetVersionLabel: String(beta.versionLabel || cfg.pendingVersionLabel || cfg.releasedVersionLabel || '').trim()
    };
  }
  return {
    channel: 'stable',
    reason: 'default_stable',
    targetVersionCode: Number(stable.versionCode || cfg.releasedVersionCode || 0) || 0,
    targetVersionLabel: String(stable.versionLabel || cfg.releasedVersionLabel || '').trim()
  };
}

function resolveReleasedVersionEligibility(updateControl, principal) {
  const isSuperAdmin = hasSuperAdminClaim((principal && principal.token) || {});
  if (isSuperAdmin) {
    return {
      eligible: true,
      reason: 'super_admin',
      rollout: normalizeRolloutPolicy(updateControl && updateControl.rollout)
    };
  }
  const rollout = normalizeRolloutPolicy(updateControl && updateControl.rollout);
  const nowMs = Date.now();
  const uid = String((principal && principal.uid) || '');
  const ownerId = String((principal && principal.ownerId) || '');
  const tenantId = String((principal && principal.tenantId) || '');
  const inAllowList =
    rollout.userIds.includes(uid) ||
    rollout.ownerIds.includes(ownerId) ||
    rollout.tenantIds.includes(tenantId);
  if (inAllowList) {
    return { eligible: true, reason: 'allow_list', rollout };
  }
  if (rollout.mode === 'allow_list' || rollout.mode === 'targeted') {
    return { eligible: false, reason: 'not_targeted', rollout };
  }
  if (rollout.startsAtMs > 0 && nowMs < rollout.startsAtMs) {
    return { eligible: false, reason: 'not_started', rollout };
  }
  if (rollout.rolloutPercent >= 100) {
    return { eligible: true, reason: 'global', rollout };
  }
  const bucket = stablePercentBucket(ownerId || uid || tenantId);
  const eligible = bucket < rollout.rolloutPercent;
  return {
    eligible,
    reason: eligible ? 'percent_rollout' : 'outside_rollout_bucket',
    rollout: {
      ...rollout,
      bucket
    }
  };
}

function sanitizeChangelogEntries(rawEntries) {
  if (!Array.isArray(rawEntries)) return [];
  const out = [];
  for (const row of rawEntries) {
    const value = String(row == null ? '' : row).trim();
    if (!value) continue;
    out.push(value.slice(0, 220));
    if (out.length >= 80) break;
  }
  return out;
}

function buildReleaseDocId(versionCode) {
  // Legacy: build doc id from numeric code.
  // Keep compatibility by using numeric id when versionCode is provided,
  // otherwise fall back to a sanitized label if present on payload consumers.
  return `v${Number(versionCode || 0) || 0}`;
}

function resolveReleasedBuildMeta(payload, versionCode, versionLabel) {
  const buildMeta = (payload.build && typeof payload.build === 'object') ? payload.build : {};
  const scriptVersion = Math.max(
    0,
    Number(buildMeta.scriptVersion || versionCode) || 0
  ) || Math.max(0, Number(versionCode) || 0);
  const appVersion = String(buildMeta.appVersion || versionLabel || '').trim().slice(0, 32);
  return {
    buildId: String(buildMeta.buildId || scriptVersion).slice(0, 64),
    appVersion: appVersion || String(versionLabel || '').slice(0, 32),
    scriptVersion,
    cssVersion: Math.max(0, Number(buildMeta.cssVersion || 0) || 0),
    deployedAt: String(buildMeta.deployedAt || new Date().toISOString()).slice(0, 40),
    env: String(buildMeta.env || 'prod').slice(0, 16)
  };
}

// --- Semantic version helpers ---
function isValidSemver(label) {
  if (!label || typeof label !== 'string') return false;
  return /^\d+\.\d+\.\d+$/.test(label.trim());
}

function compareSemver(a, b) {
  // returns 1 if a>b, -1 if a<b, 0 if equal
  if (!isValidSemver(a) || !isValidSemver(b)) return 0;
  const pa = a.split('.').map(n => Number(n));
  const pb = b.split('.').map(n => Number(n));
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function defaultInitialVersionLabel() {
  return '1.0.0';
}

function semverUserMessage(kind) {
  const messages = {
    invalid: 'Please enter a valid version number like 1.0.1',
    not_newer: 'The new version must be higher than the current release. Try increasing the patch number (for example 1.0.1).',
    no_pending: 'No update is ready to publish yet. Deploy your changes to TEST first.',
    unauthorized: 'Super admin access is required to release updates.'
  };
  return messages[kind] || messages.invalid;
}

function normalizeSemverLabel(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  if (/^v/i.test(s)) s = s.slice(1);
  if (isValidSemver(s)) return s;
  const parts = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!parts) return '';
  const candidate = `${parts[1]}.${parts[2] != null ? parts[2] : '0'}.${parts[3] != null ? parts[3] : '0'}`;
  return isValidSemver(candidate) ? candidate : '';
}

function bumpPatchSemver(label) {
  const normalized = normalizeSemverLabel(label) || defaultInitialVersionLabel();
  const parts = normalized.split('.').map((n) => Number(n));
  parts[2] = (Number(parts[2]) || 0) + 1;
  return parts.join('.');
}

function resolveReleaseVersionLabel(payload, current) {
  const payloadObj = (payload && typeof payload === 'object') ? payload : {};
  const currentObj = (current && typeof current === 'object') ? current : {};
  const rawPayload = String(payloadObj.versionLabel || '').trim();
  const explicit = normalizeSemverLabel(rawPayload);
  if (rawPayload && !explicit) {
    return { ok: false, code: 'invalid-argument', message: semverUserMessage('invalid') };
  }

  const released = normalizeSemverLabel(currentObj.releasedVersionLabel);
  const pending = normalizeSemverLabel(currentObj.pendingVersionLabel);
  const internal = currentObj.channels && currentObj.channels.internal
    ? normalizeSemverLabel(currentObj.channels.internal.versionLabel)
    : '';

  let versionLabel = explicit;
  if (!versionLabel) {
    for (const candidate of [pending, internal]) {
      if (candidate && (!released || compareSemver(candidate, released) > 0)) {
        versionLabel = candidate;
        break;
      }
    }
  }
  if (!versionLabel) {
    versionLabel = bumpPatchSemver(released || defaultInitialVersionLabel());
  }
  if (!isValidSemver(versionLabel)) {
    return { ok: false, code: 'invalid-argument', message: semverUserMessage('invalid') };
  }
  if (released && compareSemver(versionLabel, released) <= 0) {
    return { ok: false, code: 'failed-precondition', message: semverUserMessage('not_newer') };
  }
  return { ok: true, versionLabel };
}

function resolvePreparedVersionLabel(payload, current) {
  const payloadObj = (payload && typeof payload === 'object') ? payload : {};
  const currentObj = (current && typeof current === 'object') ? current : {};
  const rawPayload = String(payloadObj.versionLabel || '').trim();
  const explicit = normalizeSemverLabel(rawPayload);
  if (rawPayload && !explicit) {
    return { ok: false, code: 'invalid-argument', message: semverUserMessage('invalid') };
  }

  let versionLabel = explicit
    || normalizeSemverLabel(currentObj.pendingVersionLabel)
    || normalizeSemverLabel(currentObj.releasedVersionLabel)
    || defaultInitialVersionLabel();

  if (!isValidSemver(versionLabel)) {
    return { ok: false, code: 'invalid-argument', message: semverUserMessage('invalid') };
  }
  return { ok: true, versionLabel };
}

function assertAppUpdatePublisherCallable(context) {
  assertSuperAdminCallable(context);
}

function formatSubscriptionStatusLabel(sub, user) {
  if (sub && sub.lifetime) return 'Lifetime';
  if (sub && sub.activated === false) return 'Inactive';
  if (sub && sub.endDate) {
    const end = new Date(sub.endDate);
    if (!Number.isNaN(end.getTime()) && end < new Date()) return 'Expired';
    return 'Active';
  }
  if (user && user.isActive === false) return 'Inactive';
  return 'Active';
}

function buildRolloutFromPublishTarget(payload, current) {
  const payloadObj = (payload && typeof payload === 'object') ? payload : {};
  const explicitTarget = String(payloadObj.target || '').trim().toLowerCase();

  if (!explicitTarget && payloadObj.rollout && typeof payloadObj.rollout === 'object') {
    const rollout = normalizeRolloutPolicy(payloadObj.rollout);
    const userIds = parseIdList(rollout.userIds || rollout.ownerIds || []);
    const isTargeted = rollout.mode === 'targeted' || rollout.mode === 'allow_list' || rollout.mode === 'selected';
    return {
      ok: true,
      rollout,
      target: isTargeted && userIds.length ? 'selected_users' : 'all',
      userIds: isTargeted ? userIds : []
    };
  }

  if (explicitTarget === 'selected_users' || explicitTarget === 'selected') {
    const userIds = parseIdList(payloadObj.userIds || []);
    if (!userIds.length) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: 'Please select at least one user for a targeted update.'
      };
    }
    return {
      ok: true,
      rollout: normalizeRolloutPolicy({
        mode: 'targeted',
        userIds,
        ownerIds: userIds,
        rolloutPercent: 100
      }),
      target: 'selected_users',
      userIds
    };
  }

  if (explicitTarget && explicitTarget !== 'all' && explicitTarget !== 'global') {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'Invalid update target. Use "all" or "selected_users".'
    };
  }

  return {
    ok: true,
    rollout: normalizeRolloutPolicy({ mode: 'global', rolloutPercent: 100, userIds: [] }),
    target: 'all',
    userIds: []
  };
}

async function assertFeatureEnabledForCallable(context, flagKey, fallback = false) {
  const flags = await getFeatureFlagsDocCached(false);
  const principal = await getPrincipalScopeFromAuth(context);
  const key = String(flagKey || '').trim();
  const hasExplicitRule = Object.prototype.hasOwnProperty.call(flags || {}, key);
  if (!hasExplicitRule && hasSuperAdminClaim((principal && principal.token) || {})) {
    // Admin-first default: super admin can access new features even before explicit rollout rule exists.
    return true;
  }
  const decision = resolveFlagForPrincipal(flags[key], principal, fallback);
  if (!decision) {
    throw new functions.https.HttpsError('permission-denied', `Feature "${flagKey}" is disabled for this account.`);
  }
  return true;
}

async function assertFeatureEnabledForPrincipal(principal, flagKey, fallback = true) {
  const flags = await getFeatureFlagsDocCached(false);
  const key = String(flagKey || '').trim();
  const p = principal || {};
  const hasExplicitRule = Object.prototype.hasOwnProperty.call(flags || {}, key);
  if (!hasExplicitRule && hasSuperAdminClaim((p && p.token) || {})) {
    return true;
  }
  const decision = resolveFlagForPrincipal(flags[key], p, fallback);
  if (!decision) {
    throw new functions.https.HttpsError('permission-denied', `Feature "${flagKey}" is disabled for this account.`);
  }
  return true;
}

async function verifySuperAdminRequest(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new functions.https.HttpsError('unauthenticated', 'Missing or invalid Authorization header.');
  }
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) {
    throw new functions.https.HttpsError('unauthenticated', 'Missing token.');
  }
  const decoded = await admin.auth().verifyIdToken(idToken);
  assertSuperAdminToken(decoded || {});
  return decoded;
}

function normalizeActivationCode(value) {
  return String(value || '').trim().toUpperCase();
}

function __tsToMillis(value) {
  try {
    if (!value) return 0;
    if (typeof value === 'number') return Number(value) || 0;
    if (value instanceof Date) return value.getTime();
    if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
    if (typeof value.seconds === 'number') return (Number(value.seconds) * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1000000);
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  } catch (_) {
    return 0;
  }
}

function __bucketKey(tsMs, bucketMs) {
  const b = Math.floor(Number(tsMs || 0) / bucketMs) * bucketMs;
  return String(b);
}

function parseActivationCodeServer(codeRaw) {
  const code = normalizeActivationCode(codeRaw);
  if (!code) return null;
  const patterns = [
    { type: 'YEAR', re: /^Y{10}\d{9}$/, days: 364 },
    { type: 'MONTH', re: /^M{10,11}\d{9}$/, days: 30 },
    { type: 'TRIAL', re: /^T{11}\d{9}$/, days: 1 },
    { type: 'LIFETIME', re: /^L{10}\d{9}$/, days: null }
  ];
  for (const pattern of patterns) {
    if (pattern.re.test(code)) {
      return {
        type: pattern.type,
        code,
        days: pattern.days
      };
    }
  }
  return null;
}

function buildSubscriptionFromActivation({ existingSub, parsed, nowIso }) {
  const now = new Date(nowIso);
  let newStart = nowIso;
  let newEnd = null;
  let lifetime = false;

  if (parsed.type === 'LIFETIME') {
    lifetime = true;
  } else {
    const daysToAdd = Number(parsed.days || 0);
    const end = new Date(now);
    end.setUTCDate(end.getUTCDate() + daysToAdd);
    newEnd = end.toISOString();
  }

  if (!lifetime && existingSub && existingSub.activated && !existingSub.lifetime && existingSub.endDate) {
    const currentEnd = new Date(existingSub.endDate);
    if (currentEnd > now) {
      const stackedEnd = new Date(currentEnd);
      stackedEnd.setUTCDate(stackedEnd.getUTCDate() + Number(parsed.days || 0));
      newStart = existingSub.startDate || newStart;
      newEnd = stackedEnd.toISOString();
    }
  }

  return {
    userId: existingSub && existingSub.userId ? existingSub.userId : null,
    activated: true,
    type: parsed.type || '',
    code: parsed.code || '',
    startDate: newStart,
    endDate: lifetime ? null : newEnd,
    lifetime,
    daysRemaining: null
  };
}

exports.bootstrapSuperAdminAccess = functions.region('us-central1').https.onCall(async (_data, context) => {
  if (!context || !context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const actorUid = context.auth.uid;
  const token = context.auth.token || {};
  const actorEmail = normalizeEmail(token.email || '');
  assertBootstrapSuperAdminEmail(actorEmail);

  const authUser = await admin.auth().getUser(actorUid);
  const existingClaims = (authUser && authUser.customClaims) ? authUser.customClaims : {};
  const mergedClaims = {
    ...existingClaims,
    super_admin: true,
    superAdmin: true
  };
  await admin.auth().setCustomUserClaims(actorUid, mergedClaims);

  await admin.firestore().collection('users').doc(actorUid).set({
    role: 'superAdmin',
    isActive: true
  }, { merge: true });

  await writeAdminAuditLog({
    actorUid,
    actorEmail,
    targetUid: actorUid,
    action: 'bootstrap_super_admin_access',
    before: { claims: existingClaims || null },
    after: { claims: mergedClaims },
    requestId: `req_bootstrap_${Date.now()}`
  });

  return { ok: true, super_admin: true };
});

async function writeAdminAuditLog(payload) {
  await admin.firestore().collection('adminAuditLogs').add({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function refreshDeploymentControlDoc(db) {
  const snapshots = await hostingPromote.readDeploymentSnapshots();
  const ref = db.collection('appControl').doc('deployment');
  const existing = await ref.get();
  const prev = existing.exists ? (existing.data() || {}) : {};
  const latestApprovedBuild = prev.latestApprovedBuild || snapshots.test || null;
  const evaluated = hostingPromote.evaluateDeploymentStatus(snapshots, {
    ...prev,
    latestApprovedBuild
  });
  await ref.set({
    test: snapshots.test || null,
    prod: snapshots.prod || null,
    latestApprovedBuild,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return {
    environment: 'test',
    test: evaluated.test,
    prod: evaluated.prod,
    latestApprovedBuild: evaluated.latestApprovedBuild,
    lastPromotion: prev.lastPromotion || null,
    buildMetadataAvailable: evaluated.buildMetadataAvailable,
    promotionRequired: evaluated.promotionRequired,
    releaseAllowed: evaluated.releaseAllowed,
    promoteAllowed: evaluated.promoteAllowed,
    statusMessage: evaluated.statusMessage,
    promoteMessage: evaluated.promoteMessage
  };
}

async function loadDeploymentControl(db) {
  const ref = db.collection('appControl').doc('deployment');
  const snap = await ref.get();
  let stored = snap.exists ? (snap.data() || {}) : {};
  try {
    const live = await hostingPromote.readDeploymentSnapshots();
    stored = {
      ...stored,
      test: live.test || stored.test || null,
      prod: live.prod || stored.prod || null
    };
  } catch (_) {}
  const evaluated = hostingPromote.evaluateDeploymentStatus(stored, stored);
  return {
    ...stored,
    buildMetadataAvailable: evaluated.buildMetadataAvailable,
    promotionRequired: evaluated.promotionRequired,
    releaseAllowed: evaluated.releaseAllowed,
    promoteAllowed: evaluated.promoteAllowed,
    statusMessage: evaluated.statusMessage,
    promoteMessage: evaluated.promoteMessage
  };
}

async function assertProductionReadyForUserRelease(db) {
  const deployment = await loadDeploymentControl(db);
  if (!deployment.buildMetadataAvailable) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Build information unavailable. Cannot verify production deployment.'
    );
  }
  if (deployment.promotionRequired) {
    const testVersion = Number(deployment.test && deployment.test.scriptVersion || 0) || 0;
    const prodVersion = Number(deployment.prod && deployment.prod.scriptVersion || 0) || 0;
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Promote TEST build ${testVersion} to Production before releasing to users. (Production build: ${prodVersion})`
    );
  }
  if (!deployment.releaseAllowed) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      deployment.statusMessage || 'Production is not ready for user release.'
    );
  }
  return deployment;
}

function applyProdBuildToReleasePayload(payload, deployment) {
  const payloadObj = (payload && typeof payload === 'object') ? payload : {};
  const prodBuild = deployment && deployment.prod ? deployment.prod : {};
  const build = (payloadObj.build && typeof payloadObj.build === 'object') ? { ...payloadObj.build } : {};
  if (prodBuild && prodBuild.scriptVersion) {
    build.buildId = String(prodBuild.buildId || prodBuild.scriptVersion);
    build.scriptVersion = Number(prodBuild.scriptVersion || 0) || 0;
    build.cssVersion = Number(prodBuild.cssVersion || 0) || 0;
    build.deployedAt = String(prodBuild.deployedAt || build.deployedAt || '');
    build.appVersion = String(build.appVersion || prodBuild.appVersion || '');
  }
  build.env = 'prod';
  return { ...payloadObj, build };
}

function isLegacyInternalAppVersionLabel(label) {
  const normalized = normalizeSemverLabel(label);
  if (!normalized) return true;
  const major = Number(String(normalized).split('.')[0] || 0) || 0;
  return major >= 42;
}

exports.adminNormalizeAppVersionBaseline = functions.region('us-central1').https.onCall(async (data, context) => {
  assertSuperAdminCallable(context);
  const payload = (data && typeof data === 'object') ? data : {};
  const force = !!payload.force;
  const db = admin.firestore();
  const ref = db.collection('appControl').doc('update');
  const snap = await ref.get();
  const current = snap.exists ? (snap.data() || {}) : {};
  const released = normalizeSemverLabel(current.releasedVersionLabel);
  const baseline = defaultInitialVersionLabel();
  const shouldReset = force || isLegacyInternalAppVersionLabel(released);
  if (!shouldReset && released === baseline) {
    return {
      ok: true,
      alreadySet: true,
      releasedVersionLabel: released,
      suggestedNext: bumpPatchSemver(released)
    };
  }
  const next = bumpPatchSemver(baseline);
  const releasedBuild = (current.releasedBuild && typeof current.releasedBuild === 'object')
    ? current.releasedBuild
    : null;
  const buildCode = releasedBuild
    ? Math.max(0, Number(releasedBuild.scriptVersion || current.releasedVersionCode || 0) || 0)
    : Math.max(0, Number(current.releasedVersionCode || 0) || 0);
  await ref.set({
    releasedVersionLabel: baseline,
    pendingVersionLabel: next,
    versionBaseline: {
      label: baseline,
      resetAt: admin.firestore.FieldValue.serverTimestamp(),
      resetBy: context.auth.uid,
      previousLabel: String(current.releasedVersionLabel || '').trim()
    },
    releasedVersionCode: buildCode
  }, { merge: true });
  __appUpdateCache = { at: 0, data: {} };
  return {
    ok: true,
    releasedVersionLabel: baseline,
    suggestedNext: next,
    previousLabel: String(current.releasedVersionLabel || '').trim()
  };
});

exports.adminGetDeploymentStatus = functions.region('us-central1').https.onCall(async (_data, context) => {
  assertSuperAdminCallable(context);
  const db = admin.firestore();
  const status = await refreshDeploymentControlDoc(db);
  return { ok: true, ...status };
});

exports.adminPromoteTestBuildToProduction = functions.region('us-central1').https.onCall(async (data, context) => {
  assertSuperAdminCallable(context);
  const payload = (data && typeof data === 'object') ? data : {};
  const actorUid = context.auth.uid;
  const actorEmail = context.auth.token && context.auth.token.email ? String(context.auth.token.email) : '';
  const db = admin.firestore();
  const depRef = db.collection('appControl').doc('deployment');
  const before = await loadDeploymentControl(db);
  const fromBuildId = String((before.test && before.test.buildId) || (before.test && before.test.scriptVersion) || '').trim();

  if (!before.promoteAllowed) {
    const blockedMessage = String(before.promoteMessage || 'Cannot promote because build metadata is missing.');
    if (!before.promotionRequired && before.buildMetadataAvailable) {
      return {
        ok: true,
        alreadyPromoted: true,
        message: blockedMessage,
        prod: before.prod,
        test: before.test
      };
    }
    throw new functions.https.HttpsError('failed-precondition', blockedMessage);
  }

  const promotionId = String(payload.requestId || `promote_${Date.now()}`);
  try {
    const result = await hostingPromote.promoteTestLiveVersionToProduction();
    const prodBuild = await hostingPromote.fetchProdBuildManifestStrict(hostingPromote.PROD_HOST, 'production');
    const targetBuild = hostingPromote.getBuildNumber(result.testBuildBefore);
    const verifiedBuild = hostingPromote.getBuildNumber(prodBuild);
    if (!result.verified || !prodBuild || verifiedBuild !== targetBuild) {
      throw new Error(
        `Promotion verification failed. Production build-manifest.json must show buildId ${targetBuild}, but got ${verifiedBuild || 'no valid manifest'}.`
      );
    }

    const prodSnapshot = {
      buildId: String(prodBuild.buildId || verifiedBuild),
      appVersion: String(prodBuild.appVersion || (before.test && before.test.appVersion) || ''),
      scriptVersion: verifiedBuild,
      cssVersion: Number(prodBuild.cssVersion || (before.test && before.test.cssVersion) || 0) || 0,
      deployedAt: String(prodBuild.deployedAt || new Date().toISOString()),
      env: 'prod',
      environment: 'production',
      fetchedAt: new Date().toISOString(),
      promotedFromBuildId: fromBuildId,
      promotedAt: new Date().toISOString(),
      verifiedVia: 'build-manifest.json'
    };
    const lastPromotion = {
      id: promotionId,
      fromBuildId: fromBuildId || result.fromBuildId || '',
      toBuildId: prodSnapshot.buildId || String(prodSnapshot.scriptVersion || ''),
      sourceVersionName: result.sourceVersionName || '',
      targetSite: result.targetSite || hostingPromote.PROD_SITE,
      sourceSite: result.sourceSite || hostingPromote.TEST_SITE,
      actorUid,
      actorEmail,
      status: 'success',
      message: `Production deployed successfully. Build ${prodSnapshot.scriptVersion} verified on build-manifest.json.`,
      at: new Date().toISOString()
    };
    await depRef.set({
      test: before.test,
      prod: prodSnapshot,
      latestApprovedBuild: before.test,
      lastPromotion,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await writeAdminAuditLog({
      actorUid,
      actorEmail,
      targetUid: actorUid,
      action: 'promote_test_build_to_production',
      before: {
        testBuildId: fromBuildId,
        prodBuildId: (before.prod && before.prod.buildId) || ''
      },
      after: {
        prodBuildId: prodSnapshot.buildId,
        prodScriptVersion: prodSnapshot.scriptVersion,
        sourceVersionName: result.sourceVersionName || ''
      },
      requestId: promotionId
    });
    return {
      ok: true,
      verified: true,
      message: lastPromotion.message,
      prod: prodSnapshot,
      test: before.test,
      lastPromotion
    };
  } catch (error) {
    const errMsg = String((error && error.message) || error || 'Unknown promotion error');
    const lastPromotion = {
      id: promotionId,
      fromBuildId: fromBuildId,
      actorUid,
      actorEmail,
      status: 'failed',
      message: `Production deploy failed: ${errMsg}`,
      at: new Date().toISOString()
    };
    await depRef.set({ lastPromotion, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await writeAdminAuditLog({
      actorUid,
      actorEmail,
      targetUid: actorUid,
      action: 'promote_test_build_to_production_failed',
      before: { testBuildId: fromBuildId },
      after: { error: errMsg },
      requestId: promotionId
    });
    throw new functions.https.HttpsError('internal', `Production deploy failed: ${errMsg}`);
  }
});

exports.adminListUsers = functions.region('us-central1').https.onCall(async (data, context) => {
  assertSuperAdminCallable(context);
  const rawSearch = String((data && data.search) || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(Number((data && data.limit) || 100) || 100, 300));

  const usersSnap = await admin.firestore().collection('users').limit(1000).get();
  const userRows = usersSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const subsSnap = await admin.firestore().collection('subscriptions').limit(1000).get();
  const subsByUid = new Map();
  subsSnap.docs.forEach((d) => {
    const sub = d.data() || {};
    const uid = String(sub.userId || d.id);
    subsByUid.set(uid, { id: d.id, ...sub });
  });

  let rows = userRows.map((u) => ({
    id: u.id,
    uid: u.uid || u.id,
    fullName: u.fullName || u.name || '',
    email: u.email || '',
    phone: u.phone || u.phoneNumber || u.phoneE164 || '',
    phoneE164: u.phoneE164 || '',
    phoneNumber: u.phoneNumber || '',
    storeName: u.storeName || '',
    isActive: !!u.isActive,
    role: u.role || '',
    subscription: subsByUid.get(String(u.id)) || null,
  }));

  if (rawSearch) {
    rows = rows.filter((u) => {
      const hay = `${u.fullName} ${u.email} ${u.phone} ${u.phoneE164} ${u.phoneNumber} ${u.storeName} ${u.uid}`.toLowerCase();
      return hay.includes(rawSearch);
    });
  }

  rows.sort((a, b) => String(a.fullName || a.email).localeCompare(String(b.fullName || b.email)));
  return { users: rows.slice(0, limit), total: rows.length };
});

exports.adminSetSubscription = functions.region('us-central1').https.onCall(async (data, context) => {
  assertSuperAdminCallable(context);
  const actorUid = context.auth.uid;
  const actorEmail = context.auth.token && context.auth.token.email ? String(context.auth.token.email) : '';

  const targetUid = String((data && data.targetUid) || '').trim();
  if (!targetUid) throw new functions.https.HttpsError('invalid-argument', 'targetUid is required.');

  const action = String((data && data.action) || 'set').trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const subRef = admin.firestore().collection('subscriptions').doc(targetUid);
  const userRef = admin.firestore().collection('users').doc(targetUid);
  const beforeSnap = await subRef.get();
  const before = beforeSnap.exists ? beforeSnap.data() : null;

  let nextPayload = null;
  if (action === 'activate') {
    const startDate = String((data && data.startDate) || nowIso);
    const endDate = String((data && data.endDate) || nowIso);
    nextPayload = {
      userId: targetUid,
      activated: true,
      lifetime: false,
      startDate,
      endDate,
      type: 'MANUAL',
      code: 'ADMIN_ACTIVATE',
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: before && before.createdAt ? before.createdAt : admin.firestore.FieldValue.serverTimestamp(),
    };
  } else if (action === 'deactivate') {
    nextPayload = {
      userId: targetUid,
      activated: false,
      lifetime: false,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: before && before.createdAt ? before.createdAt : admin.firestore.FieldValue.serverTimestamp(),
    };
  } else if (action === 'extend') {
    const extendDays = Number((data && data.extendDays) || 0);
    if (!Number.isFinite(extendDays) || extendDays <= 0) {
      throw new functions.https.HttpsError('invalid-argument', 'extendDays must be > 0.');
    }
    const baseEnd = before && before.endDate ? new Date(before.endDate) : new Date();
    const nowDate = new Date();
    const start = (baseEnd > nowDate) ? baseEnd : nowDate;
    start.setDate(start.getDate() + extendDays);
    nextPayload = {
      userId: targetUid,
      activated: true,
      lifetime: false,
      endDate: start.toISOString(),
      startDate: before && before.startDate ? before.startDate : nowIso,
      type: 'MANUAL',
      code: 'ADMIN_EXTEND',
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: before && before.createdAt ? before.createdAt : admin.firestore.FieldValue.serverTimestamp(),
    };
  } else if (action === 'lifetime') {
    nextPayload = {
      userId: targetUid,
      activated: true,
      lifetime: true,
      startDate: before && before.startDate ? before.startDate : nowIso,
      endDate: null,
      type: 'LIFETIME',
      code: 'ADMIN_LIFETIME',
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: before && before.createdAt ? before.createdAt : admin.firestore.FieldValue.serverTimestamp(),
    };
  } else {
    throw new functions.https.HttpsError('invalid-argument', 'Unsupported action.');
  }

  await subRef.set(nextPayload, { merge: true });
  if (action === 'activate' || action === 'deactivate') {
    await userRef.set({ isActive: action === 'activate' }, { merge: true });
  }

  await writeAdminAuditLog({
    actorUid,
    actorEmail,
    targetUid,
    action: `subscription_${action}`,
    before: before || null,
    after: {
      userId: targetUid,
      activated: action === 'deactivate' ? false : true,
      lifetime: action === 'lifetime',
      startDate: nextPayload.startDate || null,
      endDate: nextPayload.endDate || null,
      type: nextPayload.type || '',
      code: nextPayload.code || '',
    },
    requestId: String((data && data.requestId) || `req_${Date.now()}`),
  });

  return { ok: true };
});

exports.checkSignupAvailability = functions.region('us-central1').https.onCall(async (data) => {
  const payload = (data && typeof data === 'object') ? data : {};
  const email = normalizeEmail(payload.email || '');
  const storeName = normalizeSpaces(payload.storeName || '');
  const phoneE164 = String(payload.phoneE164 || '').trim();
  const subdomain = normalizeStoreSubdomainFromName(storeName);
  const db = admin.firestore();
  const reservedSubdomains = new Set(['admin', 'api', 'www', 'app', 'dashboard', 'login', 'signup', 'settings', 'help', 'support']);

  const response = {
    ok: true,
    normalized: {
      email,
      storeName,
      subdomain,
      phoneE164
    },
    availability: {
      email: true,
      storeName: true,
      phone: true
    },
    reasons: []
  };

  if (!email) {
    response.availability.email = false;
    response.reasons.push({ field: 'email', code: 'email-required', message: 'Email is required.' });
  }
  if (!storeName) {
    response.availability.storeName = false;
    response.reasons.push({ field: 'storeName', code: 'store-name-required', message: 'Store name is required.' });
  }
  if (!subdomain) {
    response.availability.storeName = false;
    response.reasons.push({ field: 'storeName', code: 'invalid-store-name', message: 'Store name contains unsupported characters.' });
  }
  if (subdomain && reservedSubdomains.has(subdomain)) {
    response.availability.storeName = false;
    response.reasons.push({ field: 'storeName', code: 'subdomain-reserved', message: 'This store name is reserved.' });
  }
  if (phoneE164 && !/^\+\d{7,18}$/.test(phoneE164)) {
    response.availability.phone = false;
    response.reasons.push({ field: 'phone', code: 'invalid-phone', message: 'Invalid phone number.' });
  }

  if (email) {
    try {
      await admin.auth().getUserByEmail(email);
      response.availability.email = false;
      response.reasons.push({ field: 'email', code: 'email-taken', message: 'This email is already registered.' });
    } catch (err) {
      if (!(err && err.code === 'auth/user-not-found')) {
        throw new functions.https.HttpsError('internal', err && err.message ? err.message : 'Email availability check failed.');
      }
    }
  }

  if (subdomain && response.availability.storeName) {
    const reservationRef = db.collection('storeSubdomains').doc(subdomain);
    const reservationSnap = await reservationRef.get();
    if (reservationSnap.exists) {
      const ownerId = String((reservationSnap.data() && reservationSnap.data().ownerId) || '').trim();
      const [ownerUserSnap, ownerStoreSnap] = await Promise.all([
        ownerId ? db.collection('users').doc(ownerId).get() : Promise.resolve({ exists: false }),
        ownerId ? db.collection('stores').doc(ownerId).get() : Promise.resolve({ exists: false })
      ]);
      const staleReservation = !!ownerId && !ownerUserSnap.exists && !ownerStoreSnap.exists;
      if (staleReservation) {
        try { await reservationRef.delete(); } catch (_) {}
      } else {
        response.availability.storeName = false;
        response.reasons.push({ field: 'storeName', code: 'subdomain-taken', message: 'This username is already taken.' });
      }
    }
  }

  if (subdomain && response.availability.storeName) {
    const storesSnap = await db.collection('stores').where('subdomain', '==', subdomain).limit(1).get();
    if (!storesSnap.empty) {
      response.availability.storeName = false;
      response.reasons.push({ field: 'storeName', code: 'subdomain-taken', message: 'This username is already taken.' });
    }
  }

  if (phoneE164 && response.availability.phone) {
    const phoneSnap = await db.collection('users').where('phoneE164', '==', phoneE164).limit(1).get();
    if (!phoneSnap.empty) {
      response.availability.phone = false;
      response.reasons.push({ field: 'phone', code: 'phone-taken', message: 'This phone number is already in use.' });
    }
  }

  return response;
});

exports.adminPrepareAppUpdate = functions.region('us-central1').https.onCall(async (data, context) => {
  assertSuperAdminCallable(context);
  const payload = (data && typeof data === 'object') ? data : {};
  const actorUid = context.auth.uid;
  const actorEmail = context.auth.token && context.auth.token.email ? String(context.auth.token.email) : '';
  const versionCode = Math.max(1, Number(payload.versionCode || 0) || 0);
  if (!versionCode) {
    throw new functions.https.HttpsError('invalid-argument', 'versionCode is required.');
  }
  const db = admin.firestore();
  const currentSnap = await db.collection('appControl').doc('update').get();
  const current = currentSnap.exists ? (currentSnap.data() || {}) : {};
  const preparedVersion = resolvePreparedVersionLabel(payload, current);
  if (!preparedVersion.ok) {
    throw new functions.https.HttpsError(preparedVersion.code, preparedVersion.message);
  }
  const versionLabel = preparedVersion.versionLabel;
  const changelog = sanitizeChangelogEntries(payload.changelog || payload.releaseNotes || []);
  const rollout = normalizeRolloutPolicy(payload.rollout || {});
  const backupPlan = {
    required: payload.backupRequired !== false,
    backupId: String(payload.backupId || `backup_${Date.now()}`).trim().slice(0, 120),
    storageHint: String(payload.backupStorageHint || '').trim().slice(0, 400),
    preparedAt: admin.firestore.FieldValue.serverTimestamp(),
    preparedBy: actorUid
  };
  const channels = (current.channels && typeof current.channels === 'object') ? current.channels : {};
  channels.internal = {
    versionCode,
    versionLabel,
    selectors: {},
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actorUid
  };
  await db.collection('appControl').doc('update').set({
    pendingVersionCode: versionCode,
    pendingVersionLabel: versionLabel,
    pendingChangelog: changelog,
    pendingRollout: rollout,
    channels,
    masterAccountUids: parseIdList(payload.masterAccountUids || current.masterAccountUids || []),
    pendingBackup: backupPlan,
    pendingAt: admin.firestore.FieldValue.serverTimestamp(),
    pendingBy: actorUid
  }, { merge: true });

  await writeAdminAuditLog({
    actorUid,
    actorEmail,
    targetUid: actorUid,
    action: 'prepare_app_update',
    before: null,
    after: {
      pendingVersionCode: versionCode,
      pendingVersionLabel: versionLabel,
      changelogCount: changelog.length,
      rollout,
      backupPlan
    },
    requestId: String(payload.requestId || `req_prepare_update_${Date.now()}`)
  });
  return {
    ok: true,
    pendingVersionCode: versionCode,
    pendingVersionLabel: versionLabel,
    changelogCount: changelog.length
  };
});

exports.adminReleaseAppUpdate = functions.region('us-central1').https.onCall(async (data, context) => {
  assertSuperAdminCallable(context);
  const payload = (data && typeof data === 'object') ? data : {};
  const actorUid = context.auth.uid;
  const actorEmail = context.auth.token && context.auth.token.email ? String(context.auth.token.email) : '';
  const db = admin.firestore();
  const deployment = await assertProductionReadyForUserRelease(db);
  const releasePayload = applyProdBuildToReleasePayload(payload, deployment);
  const updateRef = db.collection('appControl').doc('update');
  const snap = await updateRef.get();
  const current = snap.exists ? (snap.data() || {}) : {};
  const requestedVersion = Math.max(0, Number(releasePayload.versionCode || 0) || 0);
  const versionCode = requestedVersion || Math.max(0, Number(current.pendingVersionCode || 0) || 0);
  if (!versionCode) {
    throw new functions.https.HttpsError('failed-precondition', semverUserMessage('no_pending'));
  }
  const resolvedVersion = resolveReleaseVersionLabel(releasePayload, current);
  if (!resolvedVersion.ok) {
    throw new functions.https.HttpsError(resolvedVersion.code, resolvedVersion.message);
  }
  const versionLabel = resolvedVersion.versionLabel;
  const releasedBuild = resolveReleasedBuildMeta(releasePayload, versionCode, versionLabel);
  const effectiveVersionCode = Math.max(versionCode, releasedBuild.scriptVersion || 0);
  const changelog = sanitizeChangelogEntries(releasePayload.changelog || current.pendingChangelog || []);
  const rolloutBuild = buildRolloutFromPublishTarget(releasePayload, current);
  if (!rolloutBuild.ok) {
    throw new functions.https.HttpsError(rolloutBuild.code, rolloutBuild.message);
  }
  const rollout = rolloutBuild.rollout;
  const backupPlanRaw = (releasePayload.backup && typeof releasePayload.backup === 'object')
    ? releasePayload.backup
    : (current.pendingBackup && typeof current.pendingBackup === 'object' ? current.pendingBackup : {});
  const backupPlan = {
    required: backupPlanRaw.required !== false,
    backupId: String(backupPlanRaw.backupId || `backup_${Date.now()}`).trim().slice(0, 120),
    storageHint: String(backupPlanRaw.storageHint || '').trim().slice(0, 400),
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    approvedBy: actorUid
  };
  const channels = (current.channels && typeof current.channels === 'object') ? current.channels : {};
  channels.stable = {
    versionCode: effectiveVersionCode,
    versionLabel,
    build: releasedBuild,
    selectors: {},
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actorUid
  };

  await updateRef.set({
    releasedVersionCode: effectiveVersionCode,
    releasedVersionLabel: versionLabel,
    releasedBuild,
    releasedAt: admin.firestore.FieldValue.serverTimestamp(),
    releasedBy: actorUid,
    changelog,
    rollout,
    channels,
    latestBackup: backupPlan,
    pendingVersionCode: effectiveVersionCode,
    pendingVersionLabel: versionLabel
  }, { merge: true });

  await db.collection('appReleases').doc(buildReleaseDocId(effectiveVersionCode)).set({
    versionCode: effectiveVersionCode,
    versionLabel,
    build: releasedBuild,
    changelog,
    rollout,
    backup: backupPlan,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    releasedBy: actorUid
  }, { merge: true });

  await writeAdminAuditLog({
    actorUid,
    actorEmail,
    targetUid: actorUid,
    action: 'release_app_update',
    before: {
      pendingVersionCode: Number(current.pendingVersionCode || 0) || 0,
      releasedVersionCode: Number(current.releasedVersionCode || 0) || 0
    },
    after: {
      releasedVersionCode: effectiveVersionCode,
      releasedVersionLabel: versionLabel,
      releasedBuild,
      changelogCount: changelog.length,
      rollout,
      backupPlan
    },
    requestId: String(releasePayload.requestId || `req_release_update_${Date.now()}`)
  });
  return {
    ok: true,
    target: rolloutBuild.target,
    selectedUserCount: rolloutBuild.userIds.length,
    releasedVersionCode: effectiveVersionCode,
    releasedVersionLabel: versionLabel,
    releasedBuild,
    changelogCount: changelog.length
  };
});

/**
 * Allow the designated test account to publish the pending/internal update to all users.
 * This is a restricted helper for the test POS operator (asad28486@gmail.com).
 * It performs the same validations as adminReleaseAppUpdate but permits the test account
 * (or a super admin) to trigger the release without full super-admin tooling.
 */
exports.testPublishToAllUsers = functions.region('us-central1').https.onCall(async (data, context) => {
  assertAppUpdatePublisherCallable(context);
  const payload = (data && typeof data === 'object') ? data : {};
  const actorUid = context.auth.uid;
  const actorEmail = context.auth.token && context.auth.token.email ? String(context.auth.token.email).toLowerCase() : '';
  const db = admin.firestore();
  const deployment = await assertProductionReadyForUserRelease(db);
  const releasePayload = applyProdBuildToReleasePayload(payload, deployment);
  const updateRef = db.collection('appControl').doc('update');
  const snap = await updateRef.get();
  const current = snap.exists ? (snap.data() || {}) : {};
  const requestedVersion = Math.max(0, Number(releasePayload.versionCode || 0) || 0);
  const versionCode = requestedVersion || Math.max(0, Number(current.pendingVersionCode || 0) || 0);
  if (!versionCode) {
    throw new functions.https.HttpsError('failed-precondition', semverUserMessage('no_pending'));
  }

  const resolvedVersion = resolveReleaseVersionLabel(releasePayload, current);
  if (!resolvedVersion.ok) {
    throw new functions.https.HttpsError(resolvedVersion.code, resolvedVersion.message);
  }
  const versionLabel = resolvedVersion.versionLabel;
  const releasedBuild = resolveReleasedBuildMeta(releasePayload, versionCode, versionLabel);
  const effectiveVersionCode = Math.max(versionCode, releasedBuild.scriptVersion || 0);

  const changelog = sanitizeChangelogEntries(releasePayload.changelog || current.pendingChangelog || []);
  const rolloutBuild = buildRolloutFromPublishTarget(releasePayload, current);
  if (!rolloutBuild.ok) {
    throw new functions.https.HttpsError(rolloutBuild.code, rolloutBuild.message);
  }
  const rollout = rolloutBuild.rollout;
  const backupPlanRaw = (releasePayload.backup && typeof releasePayload.backup === 'object')
    ? releasePayload.backup
    : (current.pendingBackup && typeof current.pendingBackup === 'object' ? current.pendingBackup : {});
  const backupPlan = {
    required: backupPlanRaw.required !== false,
    backupId: String(backupPlanRaw.backupId || `backup_${Date.now()}`).trim().slice(0, 120),
    storageHint: String(backupPlanRaw.storageHint || '').trim().slice(0, 400),
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    approvedBy: actorUid
  };

  const channels = (current.channels && typeof current.channels === 'object') ? current.channels : {};
  channels.stable = {
    versionCode: effectiveVersionCode,
    versionLabel,
    build: releasedBuild,
    selectors: {},
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actorUid
  };

  await updateRef.set({
    releasedVersionCode: effectiveVersionCode,
    releasedVersionLabel: versionLabel,
    releasedBuild,
    releasedAt: admin.firestore.FieldValue.serverTimestamp(),
    releasedBy: actorUid,
    changelog,
    rollout,
    channels,
    latestBackup: backupPlan,
    pendingVersionCode: effectiveVersionCode,
    pendingVersionLabel: versionLabel
  }, { merge: true });

  await db.collection('appReleases').doc(buildReleaseDocId(effectiveVersionCode)).set({
    versionCode: effectiveVersionCode,
    versionLabel,
    build: releasedBuild,
    changelog,
    rollout,
    backup: backupPlan,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    releasedBy: actorUid
  }, { merge: true });

  await writeAdminAuditLog({
    actorUid,
    actorEmail,
    targetUid: actorUid,
    action: 'test_publish_release',
    before: {
      pendingVersionCode: Number(current.pendingVersionCode || 0) || 0,
      releasedVersionCode: Number(current.releasedVersionCode || 0) || 0
    },
    after: {
      releasedVersionCode: effectiveVersionCode,
      releasedVersionLabel: versionLabel,
      releasedBuild,
      changelogCount: changelog.length,
      rollout,
      backupPlan
    },
    requestId: String(payload.requestId || `req_test_publish_${Date.now()}`)
  });

  return {
    ok: true,
    target: rolloutBuild.target,
    selectedUserCount: rolloutBuild.userIds.length,
    releasedVersionCode: effectiveVersionCode,
    releasedVersionLabel: versionLabel,
    releasedBuild,
    changelogCount: changelog.length
  };
});

exports.listAppUpdateTargetUsers = functions.region('us-central1').https.onCall(async (data, context) => {
  assertAppUpdatePublisherCallable(context);
  const rawSearch = String((data && data.search) || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(Number((data && data.limit) || 100) || 100, 200));
  const db = admin.firestore();
  const [usersSnap, statusSnap, updateSnap, subsSnap] = await Promise.all([
    db.collection('users').limit(1000).get(),
    db.collection('updateClientStatus').limit(3000).get(),
    db.collection('appControl').doc('update').get(),
    db.collection('subscriptions').limit(1000).get()
  ]);
  const updateControl = updateSnap.exists ? (updateSnap.data() || {}) : {};
  const releasedLabel = normalizeSemverLabel(updateControl.releasedVersionLabel || '') || defaultInitialVersionLabel();
  const statuses = new Map();
  statusSnap.forEach((doc) => statuses.set(String(doc.id), doc.data() || {}));
  const subsByUid = new Map();
  subsSnap.docs.forEach((d) => {
    const sub = d.data() || {};
    subsByUid.set(String(sub.userId || d.id), sub);
  });

  let rows = usersSnap.docs.map((d) => {
    const uid = String(d.id);
    const user = d.data() || {};
    const status = statuses.get(uid) || {};
    const sub = subsByUid.get(uid) || null;
    const versionCode = Math.max(0, Number(status.currentVersionCode || 0) || 0);
    let versionLabel = normalizeSemverLabel(status.currentVersionLabel || '')
      || normalizeSemverLabel(releasedLabel)
      || (versionCode ? `${versionCode}` : '-');
    if (versionLabel !== '-' && !isValidSemver(versionLabel) && versionCode) {
      versionLabel = `build ${versionCode}`;
    }
    return {
      uid,
      id: uid,
      fullName: String(user.fullName || user.name || '').trim(),
      email: String(user.email || '').trim(),
      storeName: String(user.storeName || '').trim(),
      versionCode,
      versionLabel,
      status: formatSubscriptionStatusLabel(sub, user),
      updateStatus: String(status.status || 'unknown').trim() || 'unknown'
    };
  });

  if (rawSearch) {
    rows = rows.filter((u) => {
      const hay = `${u.fullName} ${u.email} ${u.storeName} ${u.uid}`.toLowerCase();
      return hay.includes(rawSearch);
    });
  }

  rows.sort((a, b) => String(a.fullName || a.email || a.uid).localeCompare(String(b.fullName || b.email || b.uid)));
  return { ok: true, users: rows.slice(0, limit), total: rows.length };
});

exports.adminCreateDemoAccount = functions.region('us-central1').https.onCall(async (data, context) => {
  assertSuperAdminCallable(context);
  const payload = (data && typeof data === 'object') ? data : {};
  const actorUid = context.auth.uid;
  const actorEmail = context.auth.token && context.auth.token.email ? String(context.auth.token.email) : '';
  const email = normalizeEmail(payload.email || '');
  if (!email) throw new functions.https.HttpsError('invalid-argument', 'email is required.');
  const fullName = String(payload.fullName || payload.name || email.split('@')[0] || 'Demo Account').trim().slice(0, 120) || 'Demo Account';
  const trialDays = Math.max(1, Math.min(Number(payload.trialDays || 14) || 14, 90));
  const password = String(payload.password || `Demo#${Math.random().toString(36).slice(2, 10)}A1`).trim();
  if (password.length < 8) {
    throw new functions.https.HttpsError('invalid-argument', 'password must be at least 8 characters.');
  }
  const db = admin.firestore();
  let created = null;
  let reusedExisting = false;
  try {
    const existingAuth = await admin.auth().getUserByEmail(email);
    const existingUid = String(existingAuth && existingAuth.uid || '').trim();
    if (!existingUid) {
      throw new functions.https.HttpsError('internal', 'Failed to resolve existing user uid.');
    }
    const existingClaims = (existingAuth && existingAuth.customClaims) ? existingAuth.customClaims : {};
    const existingUserSnap = await db.collection('users').doc(existingUid).get();
    const existingUser = existingUserSnap.exists ? (existingUserSnap.data() || {}) : {};
    const isDemoLike = !!(
      existingUser.isDemo === true ||
      existingClaims.demo_account === true ||
      existingClaims.demoAccount === true
    );
    if (!isDemoLike) {
      throw new functions.https.HttpsError(
        'already-exists',
        'Email belongs to an existing non-demo account. Use a different email.'
      );
    }
    await admin.auth().updateUser(existingUid, {
      password,
      emailVerified: true,
      displayName: fullName,
      disabled: false
    });
    await admin.auth().setCustomUserClaims(existingUid, {
      ...existingClaims,
      demo_account: true,
      demoAccount: true
    });
    created = { uid: existingUid };
    reusedExisting = true;
  } catch (err) {
    if (!(err && err.code === 'auth/user-not-found')) throw err;
  }

  if (!created) {
    created = await admin.auth().createUser({
      email,
      password,
      emailVerified: true,
      displayName: fullName,
      disabled: false
    });
    await admin.auth().setCustomUserClaims(created.uid, {
      demo_account: true,
      demoAccount: true
    });
  }

  const nowIso = new Date().toISOString();
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + trialDays);
  const endIso = end.toISOString();
  const userDocPayload = {
    uid: created.uid,
    email,
    fullName,
    name: fullName,
    role: 'user',
    isActive: true,
    isDemo: true,
    updatedBy: actorUid,
    demoRefreshedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  if (!reusedExisting) {
    userDocPayload.createdBy = actorUid;
    userDocPayload.createdAt = admin.firestore.FieldValue.serverTimestamp();
  }
  await db.collection('users').doc(created.uid).set(userDocPayload, { merge: true });
  await db.collection('subscriptions').doc(created.uid).set({
    userId: created.uid,
    activated: true,
    lifetime: false,
    type: 'DEMO_TRIAL',
    code: `ADMIN_DEMO_${trialDays}D`,
    startDate: nowIso,
    endDate: endIso,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  await writeAdminAuditLog({
    actorUid,
    actorEmail,
    targetUid: created.uid,
    action: reusedExisting ? 'reuse_demo_account' : 'create_demo_account',
    before: null,
    after: {
      demoUid: created.uid,
      email,
      reusedExisting,
      trialDays,
      endDate: endIso
    },
    requestId: String(payload.requestId || `req_create_demo_${Date.now()}`)
  });
  return {
    ok: true,
    uid: created.uid,
    email,
    reused: reusedExisting,
    password,
    trialDays,
    endDate: endIso
  };
});

function buildUserScopeForUpdateTargeting(uid, userLike) {
  const user = (userLike && typeof userLike === 'object') ? userLike : {};
  const ownerId = String(
    user.parentAdminId ||
    user.parentAdminID ||
    user.parentId ||
    user.parentUid ||
    user.ownerId ||
    user.ownerUid ||
    uid
  ).trim();
  const tenantId = String(
    user.tenantId ||
    user.tenantID ||
    user.tenant ||
    user.storeId ||
    ownerId
  ).trim();
  const userPlan = String(
    user.plan ||
    user.subscriptionPlan ||
    user.planId ||
    user.pricingPlan ||
    ''
  ).trim().toLowerCase();
  const branchId = String(
    user.branchId ||
    user.branch ||
    user.storeBranch ||
    user.storeBranchId ||
    ''
  ).trim().toLowerCase();
  return {
    uid: String(uid || '').trim(),
    ownerId,
    tenantId,
    userPlan,
    branchId,
    token: {}
  };
}

exports.adminSetUpdateChannels = functions.region('us-central1').https.onCall(async (data, context) => {
  assertSuperAdminCallable(context);
  const payload = (data && typeof data === 'object') ? data : {};
  const actorUid = context.auth.uid;
  const actorEmail = context.auth.token && context.auth.token.email ? String(context.auth.token.email) : '';
  const channel = String(payload.channel || 'stable').trim().toLowerCase();
  if (!['internal', 'beta', 'stable'].includes(channel)) {
    throw new functions.https.HttpsError('invalid-argument', 'channel must be internal, beta, or stable.');
  }
  const db = admin.firestore();
  const ref = db.collection('appControl').doc('update');
  const snap = await ref.get();
  const current = snap.exists ? (snap.data() || {}) : {};
  const versionCode = Math.max(0, Number(payload.versionCode || current.pendingVersionCode || current.releasedVersionCode || 0) || 0);
  if (!versionCode) throw new functions.https.HttpsError('failed-precondition', semverUserMessage('no_pending'));
  const preparedVersion = resolvePreparedVersionLabel(payload, current);
  if (!preparedVersion.ok) {
    throw new functions.https.HttpsError(preparedVersion.code, preparedVersion.message);
  }
  const versionLabel = preparedVersion.versionLabel;
  const selectors = normalizeChannelSelectors(payload.selectors || {});
  const channels = (current.channels && typeof current.channels === 'object') ? current.channels : {};
  channels[channel] = {
    versionCode,
    versionLabel,
    selectors,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actorUid
  };
  const updatePayload = {
    channels
  };
  if (channel === 'stable') {
    updatePayload.releasedVersionCode = versionCode;
    updatePayload.releasedVersionLabel = versionLabel;
    updatePayload.releasedAt = admin.firestore.FieldValue.serverTimestamp();
    updatePayload.releasedBy = actorUid;
  }
  if (channel === 'internal' && Array.isArray(payload.masterAccountUids)) {
    updatePayload.masterAccountUids = parseIdList(payload.masterAccountUids);
  }
  await ref.set(updatePayload, { merge: true });
  await writeAdminAuditLog({
    actorUid,
    actorEmail,
    targetUid: actorUid,
    action: `set_update_channel_${channel}`,
    before: { channel: (current.channels && current.channels[channel]) || null },
    after: { channel, versionCode, selectors },
    requestId: String(payload.requestId || `req_channel_${channel}_${Date.now()}`)
  });
  return { ok: true, channel, versionCode, selectors };
});

exports.adminEmergencyStopUpdates = functions.region('us-central1').https.onCall(async (data, context) => {
  assertSuperAdminCallable(context);
  const payload = (data && typeof data === 'object') ? data : {};
  const actorUid = context.auth.uid;
  const actorEmail = context.auth.token && context.auth.token.email ? String(context.auth.token.email) : '';
  const paused = payload.paused !== false;
  const rollbackVersionCode = Math.max(0, Number(payload.rollbackVersionCode || 0) || 0);
  let rollbackVersionLabel = '';
  if (rollbackVersionCode) {
    rollbackVersionLabel = String(payload.rollbackVersionLabel || '').trim() || String(current && current.releasedVersionLabel || '');
    if (rollbackVersionLabel && !isValidSemver(rollbackVersionLabel)) {
      // keep label empty instead of rejecting; server stores numeric rollback target primarily
      rollbackVersionLabel = '';
    }
  }
  const db = admin.firestore();
  await db.collection('appControl').doc('update').set({
    updatePaused: paused,
    emergencyStop: paused,
    rollbackVersionCode: rollbackVersionCode || null,
    rollbackVersionLabel: rollbackVersionLabel || null,
    rollbackAt: admin.firestore.FieldValue.serverTimestamp(),
    rollbackBy: actorUid
  }, { merge: true });
  await writeAdminAuditLog({
    actorUid,
    actorEmail,
    targetUid: actorUid,
    action: paused ? 'emergency_stop_updates' : 'resume_updates',
    before: null,
    after: { paused, rollbackVersionCode: rollbackVersionCode || null },
    requestId: String(payload.requestId || `req_update_pause_${Date.now()}`)
  });
  return { ok: true, paused, rollbackVersionCode: rollbackVersionCode || 0 };
});

exports.reportClientUpdateStatus = functions.region('us-central1').https.onCall(async (data, context) => {
  assertAuthenticatedCallable(context);
  const payload = (data && typeof data === 'object') ? data : {};
  const principal = await getPrincipalScopeFromAuth(context);
  const currentVersionCode = Math.max(0, Number(payload.currentVersionCode || 0) || 0);
  const currentVersionLabel = String(payload.currentVersionLabel || '').trim().slice(0, 32);
  const updateStatus = String(payload.status || 'installed').trim().toLowerCase();
  const errorMessage = String(payload.errorMessage || '').trim().slice(0, 300);
  const now = Date.now();
  const db = admin.firestore();
  await db.collection('updateClientStatus').doc(principal.uid).set({
    uid: principal.uid,
    ownerId: principal.ownerId,
    tenantId: principal.tenantId,
    userPlan: principal.userPlan || '',
    branchId: principal.branchId || '',
    currentVersionCode,
    currentVersionLabel: currentVersionLabel || null,
    status: updateStatus,
    errorMessage: errorMessage || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    clientTs: Number(payload.clientTs || now) || now
  }, { merge: true });
  await db.collection('updateDeliveryLogs').add({
    uid: principal.uid,
    ownerId: principal.ownerId,
    currentVersionCode,
    currentVersionLabel: currentVersionLabel || null,
    status: updateStatus,
    errorMessage: errorMessage || null,
    source: String(payload.source || 'web_client').slice(0, 80),
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { ok: true };
});

exports.adminGetUpdateStatusDashboard = functions.region('us-central1').https.onCall(async (_data, context) => {
  assertSuperAdminCallable(context);
  const db = admin.firestore();
  const [updateSnap, usersSnap, statusSnap] = await Promise.all([
    db.collection('appControl').doc('update').get(),
    db.collection('users').limit(3000).get(),
    db.collection('updateClientStatus').limit(3000).get()
  ]);
  const updateControl = updateSnap.exists ? (updateSnap.data() || {}) : {};
  const statuses = new Map();
  statusSnap.forEach((doc) => statuses.set(String(doc.id), { id: doc.id, ...(doc.data() || {}) }));
  const rows = [];
  const targetByChannel = { internal: 0, beta: 0, stable: 0, paused: 0 };
  const installedByChannel = { internal: 0, beta: 0, stable: 0, paused: 0 };
  usersSnap.forEach((doc) => {
    const uid = String(doc.id);
    const user = doc.data() || {};
    const principalLike = buildUserScopeForUpdateTargeting(uid, user);
    const decision = resolveChannelForPrincipal(updateControl, principalLike);
    const status = statuses.get(uid) || {};
    const channel = String(decision.channel || 'stable');
    const targetVersionCode = Math.max(0, Number(decision.targetVersionCode || 0) || 0);
    const installedVersionCode = Math.max(0, Number(status.currentVersionCode || 0) || 0);
    const installed = targetVersionCode > 0 ? installedVersionCode >= targetVersionCode : false;
    targetByChannel[channel] = Number(targetByChannel[channel] || 0) + 1;
    if (installed) installedByChannel[channel] = Number(installedByChannel[channel] || 0) + 1;
    rows.push({
      uid,
      fullName: String(user.fullName || user.name || '').trim(),
      email: String(user.email || '').trim(),
      channel,
      targetVersionCode,
      installedVersionCode,
      installed,
      status: String(status.status || ''),
      lastError: String(status.errorMessage || ''),
      lastSeenAt: status.updatedAt || null
    });
  });
  rows.sort((a, b) => {
    if (a.installed === b.installed) return String(a.email || a.uid).localeCompare(String(b.email || b.uid));
    return a.installed ? 1 : -1;
  });
  const totalTargets = Object.values(targetByChannel).reduce((sum, v) => sum + Number(v || 0), 0);
  const totalInstalled = Object.values(installedByChannel).reduce((sum, v) => sum + Number(v || 0), 0);
  return {
    ok: true,
    updateControl,
    summary: {
      totalTargets,
      totalInstalled,
      installedRatio: totalTargets > 0 ? `${totalInstalled}/${totalTargets}` : '0/0',
      targetByChannel,
      installedByChannel
    },
    rows: rows.slice(0, 500)
  };
});

exports.activateSubscriptionCode = functions.region('us-central1').https.onCall(async (data, context) => {
  assertAuthenticatedCallable(context);
  throw new functions.https.HttpsError(
    'permission-denied',
    'Self-service activation by code is disabled. Contact Super Admin.'
  );
});

exports.claimFreeMonth = functions.region('us-central1').https.onCall(async (_data, context) => {
  assertAuthenticatedCallable(context);
  throw new functions.https.HttpsError(
    'permission-denied',
    'Self-service free activation is disabled. Contact Super Admin.'
  );
});

function jsonByteSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value == null ? null : value), 'utf8');
  } catch (_) {
    return 0;
  }
}

async function sumDocTreeBytes(docRef) {
  let total = 0;
  const snap = await docRef.get();
  if (snap.exists) {
    total += jsonByteSize(snap.data() || {});
  }
  const subcols = await docRef.listCollections();
  for (const col of subcols) {
    const colSnap = await col.get();
    for (const d of colSnap.docs) {
      total += jsonByteSize(d.data() || {});
      total += await sumDocTreeBytes(d.ref);
    }
  }
  return total;
}

async function computeUsageForUid(uid) {
  const db = admin.firestore();
  const userSnap = await db.collection('users').doc(uid).get();
  const userData = userSnap.exists ? (userSnap.data() || {}) : {};
  const effectiveOwnerUid = String(
    userData.parentAdminId ||
    userData.parentAdminID ||
    userData.parentId ||
    userData.parentUid ||
    userData.ownerId ||
    uid
  );

  let totalBytes = 0;

  // Always include the caller profile size itself.
  if (userSnap.exists) totalBytes += jsonByteSize(userData);

  // Subscription is usually on owner account for sub-users.
  const subSnap = await db.collection('subscriptions').doc(effectiveOwnerUid).get();
  if (subSnap.exists) totalBytes += jsonByteSize(subSnap.data() || {});

  // Main store data lives under owner userData doc.
  totalBytes += await sumDocTreeBytes(db.collection('userData').doc(effectiveOwnerUid));
  return totalBytes;
}

async function recalculateUsageStatsForUsers(uidList) {
  const db = admin.firestore();
  let processed = 0;
  for (const uidRaw of uidList) {
    const uid = String(uidRaw || '').trim();
    if (!uid) continue;
    const bytes = await computeUsageForUid(uid);
    await db.collection('usageStats').doc(uid).set({
      ownerId: uid,
      bytes,
      megaBytes: Number((bytes / (1024 * 1024)).toFixed(3)),
      source: 'cloud_function',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    processed += 1;
  }
  return processed;
}

exports.adminRecalculateUsageStats = functions.region('us-central1').https.onCall(async (data, context) => {
  assertSuperAdminCallable(context);
  await assertFeatureEnabledForCallable(context, 'admin_usage_recalc', false);
  const targetUid = String((data && data.targetUid) || '').trim();
  // Keep interactive admin calls lightweight to avoid callable timeouts.
  const limit = Math.max(1, Math.min(Number((data && data.limit) || 50), 300));

  let uidList = [];
  if (targetUid) {
    uidList = [targetUid];
  } else {
    const usersSnap = await admin.firestore().collection('users').limit(limit).get();
    uidList = usersSnap.docs.map((d) => String(d.id));
  }

  const processed = await recalculateUsageStatsForUsers(uidList);
  return { ok: true, processed };
});

exports.resolveFeatureFlags = functions.region('us-central1').https.onCall(async (data, context) => {
  assertAuthenticatedCallable(context);
  const payload = (data && typeof data === 'object') ? data : {};
  const currentVersionCode = Number(payload.currentVersionCode || 0) || 0;
  const only = Array.isArray(payload.only)
    ? payload.only.map((v) => String(v || '').trim()).filter(Boolean)
    : null;
  const fallback = !!payload.fallback;
  const principal = await getPrincipalScopeFromAuth(context);
  const updateControl = await getAppUpdateControlCached(!!payload.forceRefresh);
  const deploymentGate = resolveDeploymentGateForPrincipal(updateControl, principal, currentVersionCode);
  const flags = await getFeatureFlagsDocCached(!!payload.forceRefresh);
  const source = only && only.length ? only : Object.keys(flags || {});
  const resolved = {};
  for (const k of source) {
    const hasExplicitRule = Object.prototype.hasOwnProperty.call(flags || {}, k);
    if (!hasExplicitRule && deploymentGate.lockedForCurrentUser) {
      // Default isolation layer: any brand-new feature stays super-admin only
      // until an explicit rollout rule is created by super admin.
      resolved[k] = false;
      continue;
    }
    resolved[k] = resolveFlagForPrincipal(flags[k], principal, fallback);
  }
  return {
    ok: true,
    resolved,
    deploymentGate,
    scope: {
      uid: principal.uid,
      ownerId: principal.ownerId,
      tenantId: principal.tenantId
    },
    generatedAt: Date.now()
  };
});

exports.trackObservabilityEvent = functions.region('us-central1').https.onCall(async (data, context) => {
  assertAuthenticatedCallable(context);
  const payload = (data && typeof data === 'object') ? data : {};
  const principal = await getPrincipalScopeFromAuth(context);
  const eventName = String(payload.eventName || payload.type || 'event').slice(0, 120);
  const category = String(payload.category || 'general').slice(0, 80);
  const source = String(payload.source || 'web_client').slice(0, 80);
  const durationMs = Math.max(0, Number(payload.durationMs || 0) || 0);
  const statusCode = Number(payload.statusCode || 0) || 0;
  const success = payload.success === undefined ? true : !!payload.success;
  const metricsRaw = (payload.metrics && typeof payload.metrics === 'object') ? payload.metrics : {};
  const metrics = {
    dbReads: Math.max(0, Number(metricsRaw.dbReads || 0) || 0),
    dbWrites: Math.max(0, Number(metricsRaw.dbWrites || 0) || 0),
    concurrentUsers: Math.max(0, Number(metricsRaw.concurrentUsers || 0) || 0)
  };

  await admin.firestore().collection('systemAnalyticsEvents').add({
    eventName,
    category,
    source,
    durationMs,
    statusCode,
    success,
    route: String(payload.route || '').slice(0, 240),
    featureKey: String(payload.featureKey || '').slice(0, 120),
    clientTs: Number(payload.clientTs || Date.now()) || Date.now(),
    actorUid: principal.uid || null,
    ownerId: principal.ownerId || null,
    tenantId: principal.tenantId || null,
    actorIsSuperAdmin: hasSuperAdminClaim((principal && principal.token) || {}),
    metrics,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { ok: true };
});

exports.clearSystemErrorLogs = functions.region('us-central1').https.onCall(async (data, context) => {
  assertSuperAdminCallable(context);
  await assertFeatureEnabledForCallable(context, 'system_alerting_phase1', true);

  const payload = (data && typeof data === 'object') ? data : {};
  const confirmAll = !!payload.confirmAll;
  const olderThanHours = Math.max(1, Math.min(Number(payload.olderThanHours || 24) || 24, 24 * 90));
  const deleteLimit = Math.max(1, Math.min(Number(payload.limit || 1200) || 1200, 5000));
  const db = admin.firestore();
  let query = db.collection('systemErrors').orderBy('createdAt', 'asc').limit(deleteLimit);
  if (!confirmAll) {
    const cutoffMs = Date.now() - (olderThanHours * 60 * 60 * 1000);
    query = db.collection('systemErrors')
      .where('createdAt', '<', new Date(cutoffMs))
      .orderBy('createdAt', 'asc')
      .limit(deleteLimit);
  }

  const snap = await query.get();
  if (snap.empty) return { ok: true, deleted: 0 };

  let batch = db.batch();
  let opCount = 0;
  let deleted = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    opCount += 1;
    deleted += 1;
    if (opCount >= 450) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }
  if (opCount > 0) await batch.commit();
  return { ok: true, deleted };
});

exports.getSystemObservabilityMetrics = functions.region('us-central1').https.onCall(async (data, context) => {
  assertSuperAdminCallable(context);
  await assertFeatureEnabledForCallable(context, 'system_analytics_dashboard', true);
  await assertFeatureEnabledForCallable(context, 'system_alerting_phase1', true);

  const payload = (data && typeof data === 'object') ? data : {};
  const hours = Math.max(1, Math.min(Number(payload.hours || 24) || 24, 168));
  const nowMs = Date.now();
  const fromMs = nowMs - (hours * 60 * 60 * 1000);
  const fromDate = new Date(fromMs);
  const db = admin.firestore();

  const [eventsSnap, errorsSnap, auditsSnap, usageSnap] = await Promise.all([
    db.collection('systemAnalyticsEvents').where('createdAt', '>=', fromDate).orderBy('createdAt', 'asc').limit(5000).get(),
    db.collection('systemErrors').where('createdAt', '>=', fromDate).orderBy('createdAt', 'asc').limit(5000).get(),
    db.collection('adminAuditLogs').where('createdAt', '>=', fromDate).orderBy('createdAt', 'asc').limit(5000).get(),
    db.collection('usageStats').limit(3000).get()
  ]);

  const bucketMs = 60 * 60 * 1000;
  const buckets = {};
  const featureUsage = {};
  const activeUsers = new Set();
  const activeUsersRecent = new Set();
  let apiCount = 0;
  let recentApiRequests = 0;
  let responseSum = 0;
  let latencyValues = [];
  let apiFailures = 0;
  let actionCount = 0;
  let salesCount = 0;
  let invoiceCount = 0;
  let dbReads = 0;
  let dbWrites = 0;
  let recentApiFailures = 0;
  let recentFunctionFailures = 0;
  let recentErrors = 0;
  let recentDbReads = 0;
  let recentDbWrites = 0;
  const recentWindowMs = 5 * 60 * 1000;

  const ensureBucket = (ts) => {
    const key = __bucketKey(ts, bucketMs);
    if (!buckets[key]) {
      buckets[key] = { ts: Number(key), requests: 0, errors: 0, actions: 0 };
    }
    return buckets[key];
  };

  eventsSnap.forEach((doc) => {
    const d = doc.data() || {};
    const ts = __tsToMillis(d.createdAt) || __tsToMillis(d.clientTs) || nowMs;
    const b = ensureBucket(ts);
    const uid = String(d.actorUid || '').trim();
    if (uid) {
      activeUsers.add(uid);
      if (ts >= nowMs - (5 * 60 * 1000)) activeUsersRecent.add(uid);
    }

    const duration = Math.max(0, Number(d.durationMs || 0) || 0);
    const statusCode = Number(d.statusCode || 0) || 0;
    const success = d.success !== false && statusCode < 500;
    const category = String(d.category || '').toLowerCase();
    const featureKey = String(d.featureKey || '').trim();

    // API performance is computed strictly from real API events
    // (exclude heartbeat/perf-only telemetry from latency/RPS).
    if (category === 'api') {
      apiCount += 1;
      b.requests += 1;
      if (ts >= nowMs - recentWindowMs) recentApiRequests += 1;
      // Drop unrealistic/outlier timings that usually come from telemetry/cold waits.
      if (duration > 0 && duration <= 20000) {
        responseSum += duration;
        latencyValues.push(duration);
      }
      if (!success || statusCode >= 400) {
        apiFailures += 1;
        b.errors += 1;
      }
    }

    if (category === 'sale') salesCount += 1;
    if (category === 'invoice') invoiceCount += 1;
    if (category === 'action' || category === 'sale' || category === 'invoice') {
      actionCount += 1;
      b.actions += 1;
    }

    if (featureKey) {
      featureUsage[featureKey] = (featureUsage[featureKey] || 0) + 1;
    } else if (d.eventName) {
      const k = String(d.eventName).slice(0, 120);
      featureUsage[k] = (featureUsage[k] || 0) + 1;
    }

    const m = (d.metrics && typeof d.metrics === 'object') ? d.metrics : {};
    const rowDbReads = Math.max(0, Number(m.dbReads || 0) || 0);
    const rowDbWrites = Math.max(0, Number(m.dbWrites || 0) || 0);
    dbReads += rowDbReads;
    dbWrites += rowDbWrites;

    if (ts >= nowMs - recentWindowMs) {
      recentDbReads += rowDbReads;
      recentDbWrites += rowDbWrites;
      if (category === 'api' && (!success || statusCode >= 400)) recentApiFailures += 1;
      const sourceLc = String(d.source || '').toLowerCase();
      const eventLc = String(d.eventName || '').toLowerCase();
      if (!success && (sourceLc.includes('function') || eventLc.includes('function'))) {
        recentFunctionFailures += 1;
      }
    }
  });

  let actionableErrorsTotal = 0;
  let actionableErrorsRecent = 0;
  const isNoiseError = (row) => {
    const typeLc = String((row && row.type) || '').toLowerCase();
    const msgLc = String((row && row.message) || '').toLowerCase();
    const details = (row && row.details && typeof row.details === 'object') ? row.details : {};
    const urlLc = String(details.url || '').toLowerCase();
    if (/getsystemobservabilitymetrics|trackobservabilityevent|adminrecalculateusagestats/.test(urlLc)) return true;
    if (typeLc === 'api_network_error' && /net::err_failed|failed to fetch|cors/.test(msgLc)) return true;
    if (msgLc.includes('feature "') && msgLc.includes('disabled for this account')) return true;
    return false;
  };

  errorsSnap.forEach((doc) => {
    const d = doc.data() || {};
    const ts = __tsToMillis(d.createdAt) || __tsToMillis(d.clientTs) || nowMs;
    if (isNoiseError(d)) return;
    const b = ensureBucket(ts);
    b.errors += 1;
    actionableErrorsTotal += 1;
    if (ts >= nowMs - recentWindowMs) {
      recentErrors += 1;
      actionableErrorsRecent += 1;
      const typeLc = String(d.type || '').toLowerCase();
      const msgLc = String(d.message || '').toLowerCase();
      if (typeLc.includes('firebase') || msgLc.includes('function')) {
        recentFunctionFailures += 1;
      }
    }
  });

  auditsSnap.forEach((doc) => {
    const d = doc.data() || {};
    const ts = __tsToMillis(d.createdAt) || nowMs;
    const b = ensureBucket(ts);
    b.actions += 1;
  });

  const usageCount = usageSnap.size;
  let totalUsageBytes = 0;
  usageSnap.forEach((doc) => {
    const d = doc.data() || {};
    totalUsageBytes += Math.max(0, Number(d.bytes || 0) || 0);
  });
  const windowSec = Math.max(1, Math.floor((nowMs - fromMs) / 1000));
  const requestsPerSecondWindow = apiCount / windowSec;
  const requestsPerSecondRecent = recentApiRequests / Math.max(1, Math.floor(recentWindowMs / 1000));
  const requestsPerSecond = Math.max(requestsPerSecondWindow, requestsPerSecondRecent);
  const latencySampleCount = latencyValues.length;
  const avgResponseTimeMs = latencySampleCount ? (responseSum / latencySampleCount) : 0;
  latencyValues = latencyValues.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const p95Idx = latencyValues.length ? Math.min(latencyValues.length - 1, Math.floor(latencyValues.length * 0.95)) : 0;
  const apiLatencyP95Ms = latencyValues.length ? latencyValues[p95Idx] : 0;

  const topFeatures = Object.entries(featureUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key, count]) => ({ key, count }));

  const timeseries = Object.values(buckets)
    .sort((a, b) => a.ts - b.ts)
    .map((x) => ({ ts: x.ts, requests: x.requests, errors: x.errors, actions: x.actions }));

  const thresholds = {
    errorSpikeCount5m: 18,
    p95LatencyMs: 2800,
    functionFailures5m: 8,
    dbUsageGrowthMbPerHour: 180,
    dbWrites5m: 7000,
    // Avoid noisy latency alerts on small traffic windows.
    minRequestCountForLatencyAlert: 30,
    minRequestCountForCriticalLatency: 80
  };
  const alertStateRef = db.collection('appControl').doc('observabilityState');
  const alertStateSnap = await alertStateRef.get();
  const prevState = alertStateSnap.exists ? (alertStateSnap.data() || {}) : {};
  const prevTotalUsageBytes = Math.max(0, Number(prevState.lastTotalUsageBytes || 0) || 0);
  const prevAtMs = __tsToMillis(prevState.lastCheckedAt) || 0;
  const prevConsecutive = (prevState.consecutiveTriggers && typeof prevState.consecutiveTriggers === 'object')
    ? prevState.consecutiveTriggers
    : {};
  const deltaBytes = totalUsageBytes - prevTotalUsageBytes;
  const deltaHours = prevAtMs > 0 ? Math.max((nowMs - prevAtMs) / 3600000, 1 / 60) : 0;
  const usageGrowthMbPerHour = deltaHours > 0
    ? Math.max(0, (deltaBytes / (1024 * 1024)) / deltaHours)
    : 0;

  const alerts = [];
  const consecutiveTriggers = {
    error_spike: 0,
    api_latency: 0,
    function_failures: 0,
    db_usage_anomaly: 0
  };
  const pushAlert = (type, severity, title, message, extra = {}) => {
    alerts.push({
      id: `${type}_${nowMs}`,
      type,
      severity,
      title,
      message,
      detectedAt: nowMs,
      ...extra
    });
  };

  if (recentErrors >= thresholds.errorSpikeCount5m) {
    consecutiveTriggers.error_spike = Number(prevConsecutive.error_spike || 0) + 1;
    pushAlert(
      'error_spike',
      (recentErrors >= thresholds.errorSpikeCount5m * 2 && consecutiveTriggers.error_spike >= 2) ? 'critical' : 'high',
      'Error Spike Detected',
      `${recentErrors} errors in last 5 minutes.`,
      { value: recentErrors, threshold: thresholds.errorSpikeCount5m }
    );
  }
  if (apiLatencyP95Ms >= thresholds.p95LatencyMs && latencySampleCount >= thresholds.minRequestCountForLatencyAlert) {
    consecutiveTriggers.api_latency = Number(prevConsecutive.api_latency || 0) + 1;
    const canEscalateCritical = latencySampleCount >= thresholds.minRequestCountForCriticalLatency;
    pushAlert(
      'api_latency',
      (canEscalateCritical && apiLatencyP95Ms >= thresholds.p95LatencyMs * 1.7 && consecutiveTriggers.api_latency >= 2) ? 'critical' : 'high',
      'API Latency Elevated',
      `P95 latency is ${Number(apiLatencyP95Ms).toFixed(1)} ms (samples: ${latencySampleCount}).`,
      { value: Number(apiLatencyP95Ms.toFixed(1)), threshold: thresholds.p95LatencyMs, latencySampleCount }
    );
  }
  if ((recentFunctionFailures + recentApiFailures) >= thresholds.functionFailures5m) {
    consecutiveTriggers.function_failures = Number(prevConsecutive.function_failures || 0) + 1;
    pushAlert(
      'function_failures',
      consecutiveTriggers.function_failures >= 2 ? 'critical' : 'high',
      'Cloud Functions Failures',
      `${recentFunctionFailures + recentApiFailures} function/api failures in last 5 minutes.`,
      { value: recentFunctionFailures + recentApiFailures, threshold: thresholds.functionFailures5m }
    );
  }
  if (usageGrowthMbPerHour >= thresholds.dbUsageGrowthMbPerHour || recentDbWrites >= thresholds.dbWrites5m) {
    consecutiveTriggers.db_usage_anomaly = Number(prevConsecutive.db_usage_anomaly || 0) + 1;
    const growth = Number(usageGrowthMbPerHour.toFixed(2));
    pushAlert(
      'db_usage_anomaly',
      (usageGrowthMbPerHour >= thresholds.dbUsageGrowthMbPerHour * 1.8 || recentDbWrites >= thresholds.dbWrites5m * 1.5) && consecutiveTriggers.db_usage_anomaly >= 2
        ? 'critical'
        : 'medium',
      'Database Usage Anomaly',
      `Usage growth ${growth} MB/h, writes(5m) ${recentDbWrites}.`,
      { value: growth, threshold: thresholds.dbUsageGrowthMbPerHour, writes5m: recentDbWrites }
    );
  }

  await alertStateRef.set({
    lastTotalUsageBytes: totalUsageBytes,
    lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastAlertsAt: nowMs,
    lastAlertsCount: alerts.length,
    consecutiveTriggers
  }, { merge: true });

  return {
    ok: true,
    rangeHours: hours,
    generatedAt: nowMs,
    performance: {
      requestsPerSecond: Number(requestsPerSecond.toFixed(3)),
      averageResponseTimeMs: Number(avgResponseTimeMs.toFixed(2)),
      apiLatencyP95Ms: Number(apiLatencyP95Ms.toFixed(2)),
      latencySampleCount
    },
    usage: {
      activeUsers: activeUsers.size,
      activeUsersFromUsageDocs: usageCount,
      operations: {
        totalActions: actionCount,
        sales: salesCount,
        invoices: invoiceCount
      },
      topFeatures
    },
    errors: {
      totalErrors: actionableErrorsTotal,
      totalErrorsWindow: actionableErrorsTotal,
      apiFailures
    },
    load: {
      concurrentUsersApprox: activeUsersRecent.size,
      databaseReads: dbReads,
      databaseWrites: dbWrites,
      functionLoadCount: auditsSnap.size
    },
    timeseries,
    alerts,
    alertSummary: {
      activeCount: alerts.length,
      recentErrors: actionableErrorsRecent,
      recentApiFailures,
      recentFunctionFailures,
      recentDbWrites,
      usageGrowthMbPerHour: Number(usageGrowthMbPerHour.toFixed(2)),
      recentApiRequests,
      latencySampleCount
    }
  };
});

const adminRecalculateUsageStatsHttpApp = express();
function isAllowedWebOrigin(origin) {
  if (!origin) return true;
  const o = String(origin || '').trim();
  if (!o) return true;
  if (/^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/i.test(o)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(o)) return true;
  if (/^https:\/\//i.test(o)) return true;
  return false;
}

adminRecalculateUsageStatsHttpApp.use((req, res, next) => {
  const origin = String((req.headers && req.headers.origin) || '');
  if (isAllowedWebOrigin(origin)) {
    res.set('Access-Control-Allow-Origin', origin || '*');
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  next();
});

const adminUsageCors = cors({
  origin(origin, callback) {
    if (isAllowedWebOrigin(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600
});
adminRecalculateUsageStatsHttpApp.use(adminUsageCors);
adminRecalculateUsageStatsHttpApp.options('*', adminUsageCors);
adminRecalculateUsageStatsHttpApp.use(express.json({ limit: '128kb' }));
adminRecalculateUsageStatsHttpApp.post('/', async (req, res) => {
  try {
    const decoded = await verifySuperAdminRequest(req);
    await assertFeatureEnabledForPrincipal({
      uid: String((decoded && decoded.uid) || ''),
      ownerId: String((decoded && (decoded.ownerId || decoded.parentAdminId)) || ''),
      tenantId: String((decoded && decoded.tenantId) || ''),
      token: decoded || {}
    }, 'admin_usage_recalc', false);
    const targetUid = String((req.body && req.body.targetUid) || '').trim();
    const limit = Math.max(1, Math.min(Number((req.body && req.body.limit) || 50), 300));
    let uidList = [];
    if (targetUid) {
      uidList = [targetUid];
    } else {
      const usersSnap = await admin.firestore().collection('users').limit(limit).get();
      uidList = usersSnap.docs.map((d) => String(d.id));
    }
    const processed = await recalculateUsageStatsForUsers(uidList);
    res.status(200).json({ result: { ok: true, processed } });
  } catch (err) {
    if (err && (err.code === 'auth/argument-error' || err.code === 'auth/id-token-expired')) {
      res.status(401).json({ error: 'unauthenticated', message: err.message || 'Invalid or expired token.' });
      return;
    }
    if (err instanceof functions.https.HttpsError) {
      const status = err.code === 'unauthenticated' ? 401 : (err.code === 'permission-denied' ? 403 : 400);
      res.status(status).json({ error: err.code, message: err.message || 'Request rejected.' });
      return;
    }
    console.error('adminRecalculateUsageStatsHttp error:', err);
    res.status(500).json({ error: 'internal', message: err && err.message ? err.message : 'Server error.' });
  }
});
exports.adminRecalculateUsageStatsHttp = functions
  .region('us-central1')
  .https.onRequest(adminRecalculateUsageStatsHttpApp);

exports.recalculateUsageStatsHourly = functions
  .region('us-central1')
  .pubsub.schedule('every 60 minutes')
  .onRun(async () => {
    const usersSnap = await admin.firestore().collection('users').limit(2000).get();
    const uidList = usersSnap.docs.map((d) => String(d.id));
    const processed = await recalculateUsageStatsForUsers(uidList);
    console.log('recalculateUsageStatsHourly processed:', processed);
    return null;
  });

function parseHm(value, fallback = { hour: 9, minute: 0 }) {
  const raw = String(value || '').trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Math.max(0, Math.min(Number(m[1]), 23));
  const mm = Math.max(0, Math.min(Number(m[2]), 59));
  return { hour: h, minute: mm };
}

function dateKeyAtOffset(nowMs, offsetMinutes = 0) {
  const shifted = nowMs + (Number(offsetMinutes || 0) * 60000);
  return new Date(shifted).toISOString().slice(0, 10);
}

function minutesOfDayAtOffset(nowMs, offsetMinutes = 0) {
  const shifted = new Date(nowMs + (Number(offsetMinutes || 0) * 60000));
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function asNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function readSaleDateKey(sale, offsetMinutes = 0) {
  if (sale && typeof sale.date === 'string' && sale.date.length >= 10) {
    return sale.date.slice(0, 10);
  }
  const ts = sale && sale.timestamp;
  if (ts && typeof ts.toMillis === 'function') {
    return dateKeyAtOffset(ts.toMillis(), offsetMinutes);
  }
  if (typeof ts === 'number' || typeof ts === 'string') {
    const ms = new Date(ts).getTime();
    if (Number.isFinite(ms)) return dateKeyAtOffset(ms, offsetMinutes);
  }
  return '';
}

function isReturnSaleLike(sale) {
  const invoice = String((sale && sale.invoiceNumber) || '');
  if (invoice.startsWith('RF-')) return true;
  if (sale && sale.returned === true) return true;
  const amount = asNumber((sale && sale.amount), 0);
  return amount < 0;
}

function saleTotalUsd(sale, exchangeRate = 89500) {
  const totalUsd = asNumber(sale && sale.totalUSD, NaN);
  if (Number.isFinite(totalUsd)) return totalUsd;
  const amount = asNumber(sale && sale.amount, 0);
  const currency = String((sale && sale.currency) || '').toUpperCase();
  if (currency === 'LBP') return amount / Math.max(1, exchangeRate);
  return amount;
}

async function getOwnerSettings(ownerId) {
  const db = admin.firestore();
  let settings = {};
  const rootSnap = await db.collection('userData').doc(ownerId).get();
  if (rootSnap.exists) {
    const root = rootSnap.data() || {};
    if (root.settings && typeof root.settings === 'object') settings = { ...root.settings };
  }
  if (!Object.keys(settings).length) {
    const mainSnap = await db.collection('userData').doc(ownerId).collection('settings').doc('main').get();
    if (mainSnap.exists) settings = { ...(mainSnap.data() || {}) };
  }
  return settings;
}

async function sendTelegramTextWithToken(botToken, chatId, text) {
  const token = String(botToken || '').trim();
  const chat = String(chatId || '').trim();
  const bodyText = String(text || '').trim();
  if (!token || !chat || !bodyText) return { ok: false, reason: 'missing_fields' };
  const tgUrl = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const { data } = await telegramFetchWithRetry({
    url: tgUrl,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text: bodyText.slice(0, 4090),
        disable_web_page_preview: true
      })
    },
    maxAttempts: 4,
    attemptBaseDelayMs: 800,
    shouldRetry: ({ res: r, data: d }) => {
      const status = r && r.status ? r.status : 0;
      const errCode = d && d.error_code;
      return status === 429 || errCode === 429 || status >= 500 || status === 408;
    }
  });
  return { ok: !!(data && data.ok), data };
}

async function analyzeOwnerAndSendAiInsights(ownerId, nowMs, options = {}) {
  const force = !!(options && options.force);
  const db = admin.firestore();
  const settings = await getOwnerSettings(ownerId);
  const telegramEnabled = settings && settings.telegramEnabled === true;
  const aiEnabled = settings && settings.aiInsightsEnabled === true;
  const chatId = String((settings && settings.telegramChatId) || '').trim();
  const botToken = String((settings && settings.telegramBotToken) || '').trim() || getConfiguredTelegramBotToken();
  if (!telegramEnabled || !aiEnabled || !chatId || !botToken) return { skipped: true, reason: 'not_configured' };

  const tzOffset = asNumber(settings.aiTimezoneOffsetMinutes, 0);
  const reportHm = parseHm(settings.aiInsightsReportTime || '09:00');
  const nowMinuteLocal = minutesOfDayAtOffset(nowMs, tzOffset);
  const targetMinuteLocal = (reportHm.hour * 60) + reportHm.minute;
  // This worker runs hourly, so use a wider post-time window to avoid missing sends.
  const reportWindowMinutes = 70;
  const minutesSinceTarget = nowMinuteLocal - targetMinuteLocal;
  if (!force && !(minutesSinceTarget >= 0 && minutesSinceTarget < reportWindowMinutes)) {
    return { skipped: true, reason: 'not_report_window' };
  }
  const todayKey = dateKeyAtOffset(nowMs, tzOffset);
  const runId = `${ownerId}_${todayKey}_${String(reportHm.hour).padStart(2, '0')}${String(reportHm.minute).padStart(2, '0')}`;
  const runRef = db.collection('aiDailyInsightsRuns').doc(runId);
  const existing = await runRef.get();
  if (!force && existing.exists) return { skipped: true, reason: 'already_sent' };
  await runRef.set({ ownerId, day: todayKey, startedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  const aiAlertCfg = (settings.aiInsightAlerts && typeof settings.aiInsightAlerts === 'object')
    ? settings.aiInsightAlerts
    : { sales: true, inventory: true, customers: true, management: true };
  const exchangeRate = Math.max(1, asNumber(settings.exchangeRate, 89500));
  const yesterdayKey = dateKeyAtOffset(nowMs - 86400000, tzOffset);
  const sevenDaysAgoKey = dateKeyAtOffset(nowMs - (7 * 86400000), tzOffset);
  const fourteenDaysAgoMs = nowMs - (14 * 86400000);

  const [salesSnap, productsSnap, customersSnap, cashTxSnap] = await Promise.all([
    db.collection('userData').doc(ownerId).collection('sales').limit(1800).get(),
    db.collection('userData').doc(ownerId).collection('products').limit(1500).get(),
    db.collection('userData').doc(ownerId).collection('customers').limit(1500).get(),
    db.collection('userData').doc(ownerId).collection('cashDrawerTx').limit(1200).get()
  ]);

  const sales = salesSnap.docs.map((d) => d.data() || {});
  const products = productsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const customers = customersSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const cashTx = cashTxSnap.docs.map((d) => d.data() || {});

  let todaySalesUsd = 0;
  let yesterdaySalesUsd = 0;
  const productQtyToday = new Map();
  const sold14dByProduct = new Map();
  const weeklyCustomerTotals = new Map();
  const returnsByDay = new Map();
  const discountsByStaff = new Map();
  let todayReturnsCount = 0;

  for (const sale of sales) {
    const dateKey = readSaleDateKey(sale, tzOffset);
    if (!dateKey) continue;
    const isReturn = isReturnSaleLike(sale);
    const totalUsd = saleTotalUsd(sale, exchangeRate);

    if (!isReturn && dateKey === todayKey) todaySalesUsd += totalUsd;
    if (!isReturn && dateKey === yesterdayKey) yesterdaySalesUsd += totalUsd;
    if (isReturn && dateKey === todayKey) todayReturnsCount += 1;
    if (isReturn && dateKey) returnsByDay.set(dateKey, (returnsByDay.get(dateKey) || 0) + 1);

    if (!isReturn && dateKey >= sevenDaysAgoKey) {
      const customerName = String((sale && sale.customerName) || '').trim() || `Customer ${String((sale && sale.customerId) || '').trim() || 'Unknown'}`;
      weeklyCustomerTotals.set(customerName, (weeklyCustomerTotals.get(customerName) || 0) + Math.max(0, totalUsd));
    }

    const discount = asNumber((sale && (sale.discountAmount || sale.discount || sale.totalDiscount || 0)), 0);
    if (dateKey === todayKey && discount > 0) {
      const staffName = String(sale && (sale.userName || sale.createdByName || sale.cashierName || sale.userId || 'Unknown')).trim();
      const rec = discountsByStaff.get(staffName) || { count: 0, totalDiscount: 0 };
      rec.count += 1;
      rec.totalDiscount += discount;
      discountsByStaff.set(staffName, rec);
    }

    const ts = sale && sale.timestamp && typeof sale.timestamp.toMillis === 'function'
      ? sale.timestamp.toMillis()
      : new Date(sale && sale.timestamp ? sale.timestamp : 0).getTime();
    const isWithin14d = Number.isFinite(ts) && ts >= fourteenDaysAgoMs;

    if (!isReturn && Array.isArray(sale.items)) {
      for (const item of sale.items) {
        const pid = String((item && (item.id || item.productId || item.sku)) || '').trim();
        const qty = Math.max(0, asNumber(item && item.quantity, 0));
        const name = String((item && item.name) || pid || 'Item');
        if (dateKey === todayKey && qty > 0) {
          const curr = productQtyToday.get(pid || name) || { name, qty: 0 };
          curr.qty += qty;
          productQtyToday.set(pid || name, curr);
        }
        if (isWithin14d && qty > 0 && (pid || name)) {
          sold14dByProduct.set(pid || name, (sold14dByProduct.get(pid || name) || 0) + qty);
        }
      }
    }
  }

  const salesDiffPct = yesterdaySalesUsd > 0
    ? ((todaySalesUsd - yesterdaySalesUsd) / yesterdaySalesUsd) * 100
    : (todaySalesUsd > 0 ? 100 : 0);
  const topProducts = Array.from(productQtyToday.values()).sort((a, b) => b.qty - a.qty).slice(0, 3);

  const lowStockThreshold = Math.max(1, asNumber(settings.lowStockThreshold, 10));
  const lowStock = [];
  const slowMoving = [];
  for (const p of products) {
    const stock = Math.max(0, asNumber(p && p.stock, 0));
    const name = String((p && p.name) || p.id || 'Product');
    const pid = String((p && (p.id || p.productId)) || name);
    if (stock <= lowStockThreshold) {
      const reorderQty = Math.max(1, (lowStockThreshold * 2) - stock);
      lowStock.push({ name, stock, reorderQty });
    }
    if (stock > lowStockThreshold && (sold14dByProduct.get(pid) || 0) === 0) {
      slowMoving.push({ name, stock });
    }
  }
  lowStock.sort((a, b) => a.stock - b.stock);
  slowMoving.sort((a, b) => b.stock - a.stock);

  const riskyDebts = [];
  for (const c of customers) {
    const debt = Math.max(0, asNumber(c.currentDebt != null ? c.currentDebt : c.creditBalance, 0));
    if (debt <= 0) continue;
    const dueRaw = c.debtDueDate || c.nextPaymentDate || c.lastDebtDueDate || null;
    const dueMs = dueRaw ? new Date(dueRaw).getTime() : NaN;
    const overdue = Number.isFinite(dueMs) && dueMs < nowMs;
    if (debt >= 250 || overdue) {
      riskyDebts.push({ name: String(c.name || c.fullName || c.customerName || 'Customer'), debt, overdue });
    }
  }
  riskyDebts.sort((a, b) => b.debt - a.debt);
  const topCustomersWeek = Array.from(weeklyCustomerTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, total]) => ({ name, total }));

  const todayCashAnomalies = cashTx.filter((tx) => {
    const ts = tx && tx.timestamp && typeof tx.timestamp.toMillis === 'function'
      ? tx.timestamp.toMillis()
      : new Date(tx && tx.timestamp ? tx.timestamp : 0).getTime();
    if (!Number.isFinite(ts) || readSaleDateKey({ timestamp: ts }, tzOffset) !== todayKey) return false;
    const t = String((tx && tx.type) || '').toLowerCase();
    const note = String((tx && tx.note) || '').toLowerCase();
    const amountUsd = Math.abs(asNumber(tx && (tx.amountUSD != null ? tx.amountUSD : tx.amount), 0));
    const amountLbp = Math.abs(asNumber(tx && tx.amountLBP, 0));
    return (t.includes('adjust') || note.includes('diff')) && (amountUsd >= 70 || amountLbp >= (70 * exchangeRate));
  }).length;

  const avgReturnsPrevDays = (() => {
    let count = 0;
    let days = 0;
    for (let i = 1; i <= 7; i++) {
      const k = dateKeyAtOffset(nowMs - (i * 86400000), tzOffset);
      count += Number(returnsByDay.get(k) || 0);
      days += 1;
    }
    return days ? (count / days) : 0;
  })();
  const returnsAnomaly = todayReturnsCount >= Math.max(3, Math.ceil(avgReturnsPrevDays * 2));
  const discountRisk = Array.from(discountsByStaff.entries())
    .map(([name, v]) => ({ name, count: v.count, totalDiscount: v.totalDiscount }))
    .sort((a, b) => b.totalDiscount - a.totalDiscount)
    .filter((x) => x.count >= 3 || x.totalDiscount >= 80)
    .slice(0, 2);

  const lines = [];
  lines.push(`🧠 Daily AI Insights`);
  lines.push(`🏬 Store: ${settings.storeName || ownerId}`);
  lines.push(`📅 ${todayKey}`);

  if (aiAlertCfg.sales !== false) {
    const trendWord = salesDiffPct >= 0 ? 'up' : 'down';
    const unusual = Math.abs(salesDiffPct) >= 30 && Math.max(todaySalesUsd, yesterdaySalesUsd) >= 100;
    lines.push('');
    lines.push('📈 Sales');
    lines.push(`• Today: $${todaySalesUsd.toFixed(2)} | Yesterday: $${yesterdaySalesUsd.toFixed(2)}`);
    lines.push(`• Trend: ${trendWord} ${Math.abs(salesDiffPct).toFixed(1)}%${unusual ? ' (unusual)' : ''}`);
    if (topProducts.length) {
      lines.push(`• Top products today: ${topProducts.map((p) => `${p.name} (${p.qty})`).join(', ')}`);
    }
  }

  if (aiAlertCfg.inventory !== false) {
    lines.push('');
    lines.push('📦 Inventory');
    if (lowStock.length) {
      lines.push(`• Low stock: ${lowStock.slice(0, 4).map((p) => `${p.name} (${p.stock}) → reorder ${p.reorderQty}`).join(' | ')}`);
    } else {
      lines.push('• Low stock: none');
    }
    if (slowMoving.length) {
      lines.push(`• Slow movement: ${slowMoving.slice(0, 3).map((p) => `${p.name} (stock ${p.stock})`).join(', ')}`);
    }
  }

  if (aiAlertCfg.customers !== false) {
    lines.push('');
    lines.push('👥 Customers & Debt');
    if (riskyDebts.length) {
      const overdueCount = riskyDebts.filter((d) => d.overdue).length;
      lines.push(`• High debt customers: ${riskyDebts.slice(0, 3).map((c) => `${c.name} ($${c.debt.toFixed(2)})`).join(', ')}`);
      lines.push(`• Overdue debts: ${overdueCount}`);
    } else {
      lines.push('• No risky debts detected.');
    }
    if (topCustomersWeek.length) {
      lines.push(`• Top customers (7d): ${topCustomersWeek.map((c) => `${c.name} ($${c.total.toFixed(0)})`).join(', ')}`);
    }
  }

  if (aiAlertCfg.management !== false) {
    lines.push('');
    lines.push('🛡️ Management');
    lines.push(`• Cash difference anomalies today: ${todayCashAnomalies}`);
    if (discountRisk.length) {
      lines.push(`• Heavy discounting by: ${discountRisk.map((d) => `${d.name} (${d.count} ops, $${d.totalDiscount.toFixed(2)})`).join(' | ')}`);
    } else {
      lines.push('• Discount risk: normal');
    }
    lines.push(`• Unusual returns: ${returnsAnomaly ? 'yes' : 'no'} (today ${todayReturnsCount})`);
  }

  lines.push('');
  lines.push('💡 Action: focus on low stock + debt collection + unusual trends today.');

  const text = lines.join('\n');
  const sendRes = await sendTelegramTextWithToken(botToken, chatId, text);
  await runRef.set({
    doneAt: admin.firestore.FieldValue.serverTimestamp(),
    status: sendRes.ok ? 'sent' : 'failed',
    summary: {
      todaySalesUsd: Number(todaySalesUsd.toFixed(2)),
      yesterdaySalesUsd: Number(yesterdaySalesUsd.toFixed(2)),
      lowStockCount: lowStock.length,
      riskyDebtCount: riskyDebts.length
    }
  }, { merge: true });
  return sendRes.ok ? { ok: true } : { skipped: true, reason: 'telegram_send_failed' };
}

exports.aiDailyInsightsTelegramHourly = functions
  .region('us-central1')
  .pubsub.schedule('every 60 minutes')
  .onRun(async () => {
    const db = admin.firestore();
    const usersSnap = await db.collection('users').limit(2500).get();
    const ownerIds = usersSnap.docs
      .map((d) => ({ id: String(d.id), data: d.data() || {} }))
      .filter((u) => !u.data.parentAdminId)
      .map((u) => u.id);
    let processed = 0;
    let sent = 0;
    const skippedByReason = {};
    const nowMs = Date.now();
    for (const ownerId of ownerIds) {
      try {
        const res = await analyzeOwnerAndSendAiInsights(ownerId, nowMs);
        processed += 1;
        if (res && res.ok) sent += 1;
        if (res && res.skipped) {
          const reason = String(res.reason || 'unknown');
          skippedByReason[reason] = Number(skippedByReason[reason] || 0) + 1;
        }
      } catch (err) {
        console.warn('aiDailyInsightsTelegramHourly owner failed:', ownerId, err && err.message ? err.message : err);
      }
    }
    console.log('aiDailyInsightsTelegramHourly completed:', { processed, sent, skippedByReason });
    return null;
  });

exports.runAiInsightsNow = functions.region('us-central1').https.onCall(async (_data, context) => {
  assertAuthenticatedCallable(context);
  const principal = await getPrincipalScopeFromAuth(context);
  await assertFeatureEnabledForCallable(context, 'telegram_proxy', true);
  const ownerId = String((principal && principal.ownerId) || (context.auth && context.auth.uid) || '').trim();
  if (!ownerId) {
    throw new functions.https.HttpsError('invalid-argument', 'Unable to resolve owner account.');
  }
  const result = await analyzeOwnerAndSendAiInsights(ownerId, Date.now(), { force: true });
  if (result && result.ok) return { ok: true, ownerId };
    return {
    ok: false,
    skipped: true,
    reason: String((result && result.reason) || 'unknown'),
    ownerId
  };
});

// Extract structured product fields from spoken/typed description — DISABLED (voice feature removed).
exports.extractProductFromSpeechSecure = functions.region('us-central1').https.onCall(async () => {
  return { disabled: true, useClientFallback: false, message: 'Voice feature removed' };
});

// Extract supplier invoice line items from image (Gemini vision).
exports.extractInvoiceFromImageSecure = functions.region('us-central1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }
  const imageBase64 = String((data && data.imageBase64) || '').trim();
  const mimeType = String((data && data.mimeType) || 'image/jpeg').trim();
  if (!imageBase64 || imageBase64.length < 100) {
    throw new functions.https.HttpsError('invalid-argument', 'Invoice image is required.');
  }
  const apiKey = String(process.env.GEMINI_API_KEY || (functions.config().gemini && functions.config().gemini.api_key) || '').trim();
  if (!apiKey) {
    return { useClientFallback: true, disabled: true, message: 'AI extraction not configured', lineItems: [] };
  }

  const schema = [
    'Return ONLY valid JSON with this structure:',
    '{',
    '  "invoiceNumber": string|null,',
    '  "invoiceDate": "YYYY-MM-DD"|null,',
    '  "supplierName": string|null,',
    '  "currency": "USD"|"LBP"|null,',
    '  "notes": string|null,',
    '  "needsReview": boolean,',
    '  "lineItems": [',
    '    {',
    '      "productName": string,',
    '      "quantity": number,',
    '      "unitCost": number,',
    '      "totalCost": number|null,',
    '      "barcode": string|null,',
    '      "expiryDate": "YYYY-MM-DD"|null,',
    '      "category": string|null,',
    '      "notes": string|null,',
    '      "confidence": number,',
    '      "needsReview": boolean',
    '    }',
    '  ]',
    '}',
    'Extract every product line from the invoice image. Support Arabic, English, mixed, printed and phone photos.',
    'Lebanon context: ليرة/LBP amounts are LBP; دولار/USD/$ are USD.',
    'ألف = 1000, مليون = 1000000 for LBP unless dollars explicitly stated.',
    'If unsure, set needsReview=true and lower confidence. Do NOT invent products.'
  ].join('\n');

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + encodeURIComponent(apiKey);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: 'You are a POS invoice OCR assistant for a Lebanese shop. Read this supplier invoice image and extract line items.\n' + schema },
            { inlineData: { mimeType: mimeType, data: imageBase64 } }
          ]
        }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
      })
    });
    const body = await res.json().catch(() => ({}));
    const raw = body && body.candidates && body.candidates[0] && body.candidates[0].content
      && body.candidates[0].content.parts && body.candidates[0].content.parts[0]
      ? String(body.candidates[0].content.parts[0].text || '')
      : '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    if (!parsed || !Array.isArray(parsed.lineItems) || !parsed.lineItems.length) {
      return { useClientFallback: true, lineItems: [], message: 'Could not extract line items' };
    }
    return Object.assign({ source: 'gemini-vision' }, parsed);
  } catch (err) {
    console.warn('extractInvoiceFromImageSecure failed:', err && err.message ? err.message : err);
    return { useClientFallback: true, lineItems: [], message: 'Extraction failed' };
  }
});
