// Firebase Authentication Module
// Handles sign up, login, logout, and password reset

class FirebaseAuth {
    constructor() {
        this.auth = window.firebaseAuth;
        this.db = window.firebaseDb;
        this.functions = window.firebaseFunctions || null;
        this.currentUser = null;
        this.init();
    }

    init() {
        // Listen for auth state changes
        if (this.auth) {
            this.auth.onAuthStateChanged((user) => {
                if (user) {
                    this.loadUserData(user.uid);
                } else {
                    this.currentUser = null;
                }
            });
        }
    }

    // Generate subdomain from store name
    generateSubdomain(storeName) {
        const normalizedStoreName = String(storeName || '')
            .replace(/\s+/g, ' ')
            .trim();
        return normalizedStoreName
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
            .replace(/\s+/g, '') // Remove spaces
            .substring(0, 50); // Limit length
    }

    normalizeEmailInput(email) {
        return String(email || '').trim().toLowerCase();
    }

    normalizePhoneE164Input(phone) {
        return String(phone || '').trim().replace(/\s+/g, '');
    }

    async checkSignupAvailability(payload = {}) {
        if (!this.functions || typeof this.functions.httpsCallable !== 'function') {
            return { ok: true, availability: { email: true, storeName: true, phone: true }, normalized: {} };
        }
        try {
            const callable = this.functions.httpsCallable('checkSignupAvailability');
            const res = await callable(payload || {});
            return res && res.data ? res.data : { ok: true, availability: { email: true, storeName: true, phone: true }, normalized: {} };
        } catch (error) {
            // Do not block signup on transient callable/API failures.
            console.warn('checkSignupAvailability unavailable; continuing with signup flow:', error && (error.message || error.code || error));
            return { ok: false, skipped: true, availability: { email: true, storeName: true, phone: true }, normalized: {} };
        }
    }

    normalizeFeatureIdentity(value) {
        return String(value || '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[^a-z0-9 ]/g, '');
    }

    isCartonConversionTargetUser(userData) {
        const nameCandidates = [
            userData && userData.fullName,
            userData && userData.name,
            userData && userData.email ? String(userData.email).split('@')[0] : ''
        ];
        const storeCandidates = [
            userData && userData.storeName,
            userData && userData.subdomain
        ];
        const allowedPairs = [
            { user: 'andre', store: ['abou charbel', 'aboucharbel'] },
            { user: 'johny', store: ['todayslook', 'todays look'] }
        ];
        return allowedPairs.some((pair) => {
            const hasUserMatch = nameCandidates.some((value) => this.normalizeFeatureIdentity(value) === pair.user);
            const hasStoreMatch = storeCandidates.some((value) => pair.store.includes(this.normalizeFeatureIdentity(value)));
            return hasUserMatch && hasStoreMatch;
        });
    }

    // Check if subdomain is available
    async checkSubdomainAvailability(subdomain) {
        try {
            if (!this.db) {
                console.warn('Firestore database not initialized - skipping subdomain check');
                return true; // Allow if DB not ready (will fail later)
            }
            
            // Reserved subdomains that cannot be used
            const reservedSubdomains = ['admin', 'api', 'www', 'app', 'dashboard', 'login', 'signup', 'settings', 'help', 'support'];
            if (reservedSubdomains.includes(subdomain.toLowerCase())) {
                return false; // Reserved subdomain is not available
            }
            
            try {
                const reservationDoc = await this.db.collection('storeSubdomains').doc(subdomain).get({ source: 'server' });
                if (reservationDoc.exists) return false;
            } catch (_) {}

            // Legacy fallback: existing store records
            const storesRef = this.db.collection('stores');
            const snapshot = await storesRef.where('subdomain', '==', subdomain).limit(1).get({ source: 'server' });
            return snapshot.empty;
        } catch (error) {
            // Handle specific permission errors gracefully
            if (error.code === 'permission-denied' || error.message?.includes('permission')) {
                console.warn('Permission denied for subdomain check - will validate during signup:', error.message);
                // Allow check to pass, Firestore rules will catch duplicates during store creation
                return true;
            }
            console.error('Error checking subdomain:', error);
            // If there's an error (like network issues), allow it and let the write fail
            return true;
        }
    }

    // Sign up new user
    // phoneInfo: { phoneE164, phoneCountryCode, phoneNationalNumber }
    async signUp(fullName, email, storeName, password, phoneInfo = null) {
        try {
            if (!this.auth) {
                throw new Error('Firebase Authentication is not initialized');
            }
            if (!this.db) {
                throw new Error('Firestore Database is not initialized');
            }

            const normalizedEmail = this.normalizeEmailInput(email);
            const normalizedStoreName = String(storeName || '').replace(/\s+/g, ' ').trim();
            const normalizedPhone = this.normalizePhoneE164Input(phoneInfo && phoneInfo.phoneE164);

            const availability = await this.checkSignupAvailability({
                email: normalizedEmail,
                storeName: normalizedStoreName,
                phoneE164: normalizedPhone
            });
            if (availability && availability.availability) {
                if (availability.availability.email === false) {
                    throw { code: 'auth/email-already-in-use', message: 'This email is already registered.' };
                }
                if (availability.availability.storeName === false) {
                    throw { code: 'subdomain-taken', message: 'This username is already taken.' };
                }
                if (availability.availability.phone === false) {
                    throw { code: 'phone-taken', message: 'This phone number is already in use.' };
                }
            }

            console.log('Generating subdomain...');
            // Generate subdomain
            let subdomain = this.generateSubdomain(normalizedStoreName);
            if (!subdomain) {
                subdomain = `store${Date.now().toString().slice(-6)}`;
            }
            let counter = 1;
            const originalSubdomain = subdomain;

            // Check availability and add number if needed (limit to 10 attempts)
            let attempts = 0;
            while (!(await this.checkSubdomainAvailability(subdomain)) && attempts < 10) {
                subdomain = `${originalSubdomain}${counter}`;
                counter++;
                attempts++;
            }

            console.log('Creating Firebase Auth user...');
            // Create Firebase Auth user
            const userCredential = await this.auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;
            console.log('User created:', user.uid);

            // Create user document in Firestore
            console.log('Creating user document in Firestore...');
            const pi = (phoneInfo && typeof phoneInfo === 'object') ? phoneInfo : {};
            const phoneE164 = String(pi.phoneE164 || '').trim();
            const phoneCountryCode = String(pi.phoneCountryCode || '').trim();
            const phoneNationalNumber = String(pi.phoneNationalNumber || '').trim();
            if (phoneE164) {
                // Minimal validation (E.164-like)
                if (!/^\+\d{7,18}$/.test(phoneE164)) {
                    throw { code: 'invalid-phone', message: 'Invalid phone number' };
                }
            }
            const userData = {
                uid: user.uid,
                fullName: fullName,
                email: normalizedEmail,
                emailLower: normalizedEmail,
                storeName: normalizedStoreName,
                storeNameNormalized: normalizedStoreName.toLowerCase(),
                subdomain: subdomain,
                role: 'user',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                isActive: true,
                phoneE164: phoneE164 || null,
                phoneCountryCode: phoneCountryCode || null,
                phoneNationalNumber: phoneNationalNumber || null
            };

            await this.db.collection('users').doc(user.uid).set(userData);
            console.log('User document created');

            // Reserve subdomain + create store atomically.
            // If the base subdomain is already taken (or race condition happens),
            // auto-generate a unique variant instead of failing signup.
            console.log('Creating store document...');
            const storeRef = this.db.collection('stores').doc(user.uid);
            const originalSubdomainForRetry = subdomain;
            let reservedSubdomain = subdomain;
            let reserveSucceeded = false;
            const maxReserveAttempts = 40;
            for (let i = 0; i < maxReserveAttempts; i++) {
                const candidate = i === 0
                    ? reservedSubdomain
                    : `${originalSubdomainForRetry}${Date.now().toString().slice(-4)}${i}`;
                const reservationRef = this.db.collection('storeSubdomains').doc(candidate);
                try {
                    await this.db.runTransaction(async (tx) => {
                        const reservationSnap = await tx.get(reservationRef);
                        if (reservationSnap.exists) {
                            throw { code: 'subdomain-taken', message: 'taken' };
                        }
                        tx.set(reservationRef, {
                            subdomain: candidate,
                            ownerId: user.uid,
                            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                            isActive: true
                        });
                        tx.set(storeRef, {
                            ownerId: user.uid,
                            storeName: normalizedStoreName,
                            subdomain: candidate,
                            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                            isActive: true
                        });
                    });
                    reservedSubdomain = candidate;
                    reserveSucceeded = true;
                    break;
                } catch (reserveErr) {
                    const msg = String((reserveErr && (reserveErr.message || reserveErr.code)) || '').toLowerCase();
                    const isTaken = (reserveErr && reserveErr.code === 'subdomain-taken')
                        || msg.includes('taken')
                        || msg.includes('already exists');
                    if (!isTaken) throw reserveErr;
                }
            }

            if (!reserveSucceeded) {
                // If store creation fails, clean up user account
                try {
                    try { await this.db.collection('storeSubdomains').doc(reservedSubdomain).delete(); } catch (_) {}
                    await user.delete();
                    await this.db.collection('users').doc(user.uid).delete();
                } catch (cleanupError) {
                    console.error('Error cleaning up user:', cleanupError);
                }
                throw {
                    code: 'subdomain-taken',
                message: `This username is already taken.`
                };
            }
            // Keep user profile and verification redirect aligned with final reserved subdomain.
            subdomain = reservedSubdomain;
            await this.db.collection('users').doc(user.uid).set({ subdomain }, { merge: true });
            console.log('Store document created');

            // Send email verification
            try {
                await user.sendEmailVerification({
                    url: `${window.location.origin}/${subdomain}`,
                    handleCodeInApp: false
                });
                console.log('Email verification sent');
            } catch (emailError) {
                console.warn('Error sending email verification:', emailError);
                // Don't fail signup if email verification fails
            }

            // Create a userData V2 (scalable) structure for the new account — without large arrays within a single document
            await this.db.collection('userData').doc(user.uid).set({
                schemaVersion: 2,
                migrationComplete: true,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            await this.db.collection('userData').doc(user.uid).collection('settings').doc('main').set({
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            await this.db.collection('userData').doc(user.uid).collection('cashDrawer').doc('summary').set({
                cashUSD: 0,
                cashLBP: 0,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log('V2 userData initialized for new account');

            // Verification by link only (free — no email extension or 6-digit code needed)

            // Subscription activation is handled server-side via Cloud Functions.
            // Keep signup focused on account creation only.

            // Load user data
            await this.loadUserData(user.uid);

            return { success: true, subdomain: subdomain, emailSent: true };
        } catch (error) {
            console.error('Sign up error details:', error);
            console.error('Error code:', error.code);
            console.error('Error message:', error.message);
            throw this.handleAuthError(error);
        }
    }

    // Sign in existing user
    async signIn(email, password) {
        try {
            const userCredential = await this.auth.signInWithEmailAndPassword(email, password);
            await this.loadUserData(userCredential.user.uid);
            return { success: true };
        } catch (error) {
            // Error handling with clear message
            const handledError = this.handleAuthError(error);
            // We do not print the error in console if it is invalid-credential (normal when wrong data is entered)
            if (error.code !== 'auth/invalid-credential' && error.code !== 'auth/user-not-found' && error.code !== 'auth/wrong-password') {
                console.error('Sign in error:', error);
            }
            throw handledError;
        }
    }

    // Sign out
    async signOut() {
        try {
            await this.auth.signOut();
            this.currentUser = null;
            return { success: true };
        } catch (error) {
            console.error('Sign out error:', error);
            throw this.handleAuthError(error);
        }
    }

    // Send password reset email
    async sendPasswordReset(email) {
        try {
            await this.auth.sendPasswordResetEmail(email);
            return { success: true };
        } catch (error) {
            console.error('Password reset error:', error);
            throw this.handleAuthError(error);
        }
    }

    escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    escapeAttr(str) {
        // Basic escaping for attributes/hrefs
        return this.escapeHtml(str).replace(/`/g, '&#96;');
    }

    buildSystemEmailTemplate({ title, preheader, greetingName, bodyHtml, ctaText, ctaUrl, footerNote }) {
        const safeTitle = this.escapeHtml(title || 'CATCH POS');
        const safePreheader = this.escapeHtml(preheader || '');
        const safeName = greetingName ? this.escapeHtml(greetingName) : '';
        const safeCtaText = this.escapeHtml(ctaText || 'Open');
        const safeCtaUrl = this.escapeAttr(ctaUrl || window.location.origin);
        const safeFooter = this.escapeHtml(footerNote || '');

        // Simple, email-client-friendly template (inline CSS, no external fonts)
        return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreheader}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6;padding:20px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,0,0,0.08);">
            <tr>
              <td style="padding:18px 20px;background:linear-gradient(135deg,#2563eb 0%,#7c3aed 100%);color:#fff;">
                <div style="font-size:14px;font-weight:800;letter-spacing:0.4px;">CATCH POS SYSTEM</div>
                <div style="font-size:20px;font-weight:900;margin-top:6px;">${safeTitle}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 20px;color:#111827;font-family:Arial,Helvetica,sans-serif;">
                ${safeName ? `<p style="margin:0 0 12px 0;font-weight:800;">Hello ${safeName},</p>` : ''}
                ${bodyHtml || ''}
                <div style="margin:18px 0 8px 0;">
                  <a href="${safeCtaUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:900;padding:12px 16px;border-radius:12px;">${safeCtaText}</a>
                </div>
                ${safeFooter ? `<p style="margin:14px 0 0 0;color:#6b7280;font-size:12px;font-weight:600;">${safeFooter}</p>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:14px 20px;background:#f9fafb;color:#6b7280;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:600;">
                © ${new Date().getFullYear()} CATCH POS — Automated message
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
    }

    // Resend verification link only (free — Firebase email)
    async resendVerificationCode() {
        try {
            const user = this.auth.currentUser;
            if (!user) {
                throw new Error('No user is signed in');
            }
            const userData = await this.loadUserData(user.uid);
            if (!userData) {
                throw new Error('User data not found');
            }
            const subdomain = userData.subdomain || '';
            const redirectUrl = subdomain ? `${window.location.origin}/${subdomain}` : window.location.origin;
            await user.sendEmailVerification({
                url: redirectUrl,
                handleCodeInApp: false
            });
            return { success: true };
        } catch (error) {
            console.error('Resend verification error:', error);
            throw this.handleAuthError(error);
        }
    }

    // Send welcome email after first signup (English): account confirmed, free month, link, email & password
    async sendWelcomeEmailAfterVerification(uid, email, password) {
        try {
            const userDoc = await this.db.collection('users').doc(uid).get();
            if (!userDoc.exists) return;
            const u = userDoc.data();
            const fullName = u.fullName || '';
            const subdomain = u.subdomain || '';
            const storeName = u.storeName || '';
            const baseUrl = window.location.origin;
            const storeUrl = subdomain ? `${baseUrl}/${subdomain}` : baseUrl;

            const subject = 'CATCH POS — Account Activated & Free Month';
            const html = this.buildSystemEmailTemplate({
                title: 'Account Activated',
                preheader: 'Your account is active with 1 free month',
                greetingName: fullName,
                bodyHtml: `
                    <p style="margin:0 0 12px 0;">Your account has been activated successfully.</p>
                    <p style="margin:0 0 12px 0;"><strong>You have received 1 free month</strong> of CATCH POS. Use the system link below to log in anytime.</p>
                    <p style="margin:0 0 12px 0;"><strong>System link:</strong></p>
                    <p style="margin:0 0 12px 0;"><a href="${this.escapeAttr(storeUrl)}" style="color:#2563eb;font-weight:800;text-decoration:none;">${this.escapeHtml(storeUrl)}</a></p>
                    <div style="margin:14px 0;padding:14px;border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;">
                        <div style="font-weight:800;margin-bottom:6px;">Login</div>
                        <p style="margin:0 0 6px 0;"><strong>Email:</strong> ${this.escapeHtml(email || '')}</p>
                        <p style="margin:0 0 8px 0;color:#6b7280;font-size:12px;">Use the password you set during registration. You can change it anytime from Settings after logging in.</p>
                    </div>
                `,
                ctaText: 'Open your store',
                ctaUrl: storeUrl,
                footerNote: 'If you did not create this account, please contact support.'
            });

            await this.db.collection('mail').add({
                to: [email],
                message: {
                    subject,
                    html,
                    text: `CATCH POS - Account activated. You have 1 free month.\n\nStore link: ${storeUrl}\nEmail: ${email}\n\nUse the password you set during registration. Change it from Settings after logging in.`
                },
                meta: { type: 'welcome_after_verification', userId: uid, subdomain },
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.warn('Welcome email send failed:', err);
        }
    }

    // Load user data from Firestore
    async loadUserData(uid) {
        try {
            const userDoc = await this.db.collection('users').doc(uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                let claims = {};
                try {
                    const authUser = this.auth && this.auth.currentUser;
                    if (authUser && typeof authUser.getIdTokenResult === 'function') {
                        const tokenResult = await authUser.getIdTokenResult(true);
                        claims = (tokenResult && tokenResult.claims) ? tokenResult.claims : {};
                    }
                } catch (_) {}
                const features = {
                    ...(userData && userData.features && typeof userData.features === 'object' ? userData.features : {})
                };
                if (this.isCartonConversionTargetUser(userData)) {
                    features.cartonConversion = true;
                }
                this.currentUser = {
                    uid: uid,
                    ...userData,
                    claims,
                    features
                };
                return this.currentUser;
            } else {
                throw new Error('User data not found');
            }
        } catch (error) {
            console.error('Error loading user data:', error);
            throw error;
        }
    }

    // Get current user
    getCurrentUser() {
        return this.currentUser;
    }

    // Check if user is authenticated
    isAuthenticated() {
        return this.auth && this.auth.currentUser !== null;
    }

    // Check if user is super admin
    isSuperAdmin() {
        const claims = (this.currentUser && this.currentUser.claims) || {};
        return !!(claims.super_admin === true || claims.superAdmin === true);
    }

    // Handle authentication errors
    handleAuthError(error) {
        const errorMessages = {
            'auth/email-already-in-use': 'Email is already in use',
            'auth/invalid-email': 'Invalid email address',
            'auth/invalid-credential': 'Invalid email or password',
            'auth/operation-not-allowed': 'Operation not allowed',
            'auth/weak-password': 'Weak password (must be at least 6 characters)',
            'auth/user-disabled': 'This account has been disabled',
            'auth/user-not-found': 'User not found',
            'auth/wrong-password': 'Incorrect password',
            'auth/too-many-requests': 'Too many attempts. Please try again later',
            'auth/network-request-failed': 'Network error. Please check your internet connection',
            'subdomain-taken': error.message || 'This username is already taken.',
            'phone-taken': error.message || 'This phone number is already in use.'
        };

        return {
            code: error.code || 'unknown',
            message: errorMessages[error.code] || error.message || 'An unexpected error occurred'
        };
    }
}

// Initialize Firebase Auth
let firebaseAuthInstance = null;

if (typeof firebase !== 'undefined' && window.firebaseAuth) {
    firebaseAuthInstance = new FirebaseAuth();
    window.firebaseAuthInstance = firebaseAuthInstance;
} else {
    console.warn('Firebase Auth not initialized. Please check firebase-config.js');
}

