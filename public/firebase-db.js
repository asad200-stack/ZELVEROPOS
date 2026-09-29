// Firebase Firestore Database Module
// Handles all database operations for users, stores, products, and orders

class FirebaseDB {
    constructor() {
        this.db = window.firebaseDb;
        this.auth = window.firebaseAuth;
        this.functions = window.firebaseFunctions || null;
        this._logThrottleMap = Object.create(null);
    }

    _logThrottled(level, key, message, details, cooldownMs = 120000) {
        const now = Date.now();
        const k = String(key || message || 'log');
        const last = Number(this._logThrottleMap[k] || 0);
        if (now - last < Math.max(1000, Number(cooldownMs) || 120000)) return;
        this._logThrottleMap[k] = now;
        const fn = (level === 'info') ? console.info : (level === 'error' ? console.error : console.warn);
        if (typeof details !== 'undefined') {
            fn(message, details);
        } else {
            fn(message);
        }
    }

    async callSecureAdminFunction(name, payload) {
        if (!this.functions || typeof this.functions.httpsCallable !== 'function') {
            throw new Error('Cloud Functions is not initialized');
        }
        const callable = this.functions.httpsCallable(name);
        const res = await callable(payload || {});
        return res && res.data ? res.data : null;
    }

    async callSecureAdminHttpFunction(name, payload) {
        const authUser = this.auth && this.auth.currentUser;
        if (!authUser || typeof authUser.getIdToken !== 'function') {
            throw new Error('Authentication required');
        }
        const idToken = await authUser.getIdToken();
        const projectId = 'pos-catch';
        const endpoint = `https://us-central1-${projectId}.cloudfunctions.net/${name}`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(payload || {})
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const msg = (data && (data.message || data.error)) || `HTTP ${response.status}`;
            throw new Error(msg);
        }
        return data && data.result ? data.result : data;
    }

    // ============ SYSTEM ERROR LOGS ============
    async logSystemError(errorPayload) {
        try {
            const authUser = this.auth && this.auth.currentUser;
            if (!authUser) return { success: false, skipped: true, reason: 'unauthenticated' };

            const payload = {
                actorUid: authUser.uid,
                actorEmail: authUser.email || null,
                actorRole: (errorPayload && errorPayload.actorRole) || null,
                message: String((errorPayload && errorPayload.message) || 'Unknown error').slice(0, 4000),
                type: String((errorPayload && errorPayload.type) || 'runtime_error').slice(0, 120),
                source: String((errorPayload && errorPayload.source) || 'web_client').slice(0, 120),
                page: String((errorPayload && errorPayload.page) || '').slice(0, 600),
                stack: String((errorPayload && errorPayload.stack) || '').slice(0, 12000),
                details: (errorPayload && typeof errorPayload.details === 'object' && errorPayload.details) ? errorPayload.details : null,
                userAgent: String((errorPayload && errorPayload.userAgent) || (typeof navigator !== 'undefined' ? navigator.userAgent : '')).slice(0, 1000),
                language: String((errorPayload && errorPayload.language) || (typeof navigator !== 'undefined' ? navigator.language : '')).slice(0, 80),
                platform: String((errorPayload && errorPayload.platform) || (typeof navigator !== 'undefined' ? navigator.platform : '')).slice(0, 120),
                clientTs: Number((errorPayload && errorPayload.clientTs) || Date.now()),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            await this.db.collection('systemErrors').add(payload);
            return { success: true };
        } catch (error) {
            console.warn('Error logging system error:', error);
            return { success: false, error: String(error && (error.message || error.code || error)) };
        }
    }

    async getSystemErrors(limitCount = 200) {
        try {
            const lim = Math.min(Math.max(Number(limitCount) || 200, 1), 1000);
            const snapshot = await this.db.collection('systemErrors')
                .orderBy('createdAt', 'desc')
                .limit(lim)
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error('Error getting system errors:', error);
            throw error;
        }
    }

    // ============================================================
    // V2 Scalable Schema Helpers (subcollections under userData/{uid})
    // ============================================================
    _userDataDoc(userId) {
        return this.db.collection('userData').doc(userId);
    }
    _userDataSubcol(userId, subcolName) {
        return this._userDataDoc(userId).collection(subcolName);
    }
    async getUserDataMeta(userId) {
        if (!userId) throw new Error('UserId is required');
        const doc = await this._userDataDoc(userId).get();
        if (!doc.exists) return { schemaVersion: 1, migrationComplete: false };
        const d = doc.data() || {};
        return {
            schemaVersion: Number(d.schemaVersion || 1),
            migrationComplete: !!d.migrationComplete,
            lastUpdated: d.lastUpdated || null
        };
    }
    async setUserDataMeta(userId, meta) {
        if (!userId) throw new Error('UserId is required');
        const payload = {
            ...meta,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        };
        await this._userDataDoc(userId).set(payload, { merge: true });
        return { success: true };
    }
    _entityToSubcollection(entity) {
        // canonical mapping
        const map = {
            products: 'products',
            customers: 'customers',
            sales: 'sales',
            suppliers: 'suppliers',
            purchases: 'purchases',
            supplierPayments: 'supplierPayments',
            purchaseReturns: 'purchaseReturns',
            supplierLedger: 'supplierLedger',
            cashDrawerTx: 'cashDrawerTx'
        };
        return map[entity] || entity;
    }
    async v2UpsertEntity(userId, entity, docId, data) {
        if (!userId) throw new Error('UserId is required');
        if (!entity) throw new Error('Entity is required');
        if (docId == null || docId === '') throw new Error('docId is required');
        const sub = this._entityToSubcollection(entity);
        await this._userDataSubcol(userId, sub).doc(String(docId)).set({
            ...(data || {}),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return { success: true };
    }
    async v2DeleteEntity(userId, entity, docId) {
        if (!userId) throw new Error('UserId is required');
        if (!entity) throw new Error('Entity is required');
        if (docId == null || docId === '') throw new Error('docId is required');
        const sub = this._entityToSubcollection(entity);
        const ref = this._userDataSubcol(userId, sub).doc(String(docId));
        const batch = this.db.batch();
        batch.delete(ref);
        if (entity === 'products') {
            const tomb = this._userDataSubcol(userId, 'deletedProducts').doc(String(docId));
            batch.set(tomb, { deletedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
        await batch.commit();
        return { success: true };
    }
    /** Paginated read of product tombstone doc ids (cross-device delete sync). */
    async v2FetchDeletedProductIds(userId, maxTotal = 20000) {
        if (!userId) throw new Error('UserId is required');
        const out = new Set();
        try {
            const col = this._userDataSubcol(userId, 'deletedProducts');
            let lastDoc = null;
            const page = 500;
            while (out.size < maxTotal) {
                let q = col.orderBy(firebase.firestore.FieldPath.documentId()).limit(page);
                if (lastDoc) q = q.startAfter(lastDoc);
                const snap = await q.get();
                if (snap.empty) break;
                snap.docs.forEach(d => out.add(d.id));
                lastDoc = snap.docs[snap.docs.length - 1];
                if (snap.docs.length < page) break;
            }
        } catch (error) {
            const code = error && error.code;
            const msg = String((error && error.message) || '');
            if (code === 'permission-denied' || /missing or insufficient permissions|permission-denied/i.test(msg)) {
                // For restricted sub-users, skip tombstone merge instead of failing app boot.
                return out;
            }
            throw error;
        }
        return out;
    }
    async v2BatchWrite(userId, ops) {
        if (!userId) throw new Error('UserId is required');
        if (!Array.isArray(ops) || ops.length === 0) return { success: true, written: 0 };
        const batch = this.db.batch();
        let written = 0;
        for (const op of ops) {
            const entity = op && op.entity;
            const docId = op && op.docId;
            const kind = op && op.op;
            if (!entity || docId == null || docId === '' || !kind) continue;
            const sub = this._entityToSubcollection(entity);
            const ref = this._userDataSubcol(userId, sub).doc(String(docId));
            if (kind === 'delete') {
                batch.delete(ref);
            } else {
                batch.set(ref, {
                    ...(op.data || {}),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
            written++;
        }
        if (written === 0) return { success: true, written: 0 };
        await batch.commit();
        try {
            const prodDeletes = ops.filter(o => o && o.entity === 'products' && o.op === 'delete' && o.docId != null && o.docId !== '');
            let i = 0;
            while (i < prodDeletes.length) {
                const tb = this.db.batch();
                const slice = prodDeletes.slice(i, i + 450);
                slice.forEach(op => {
                    const tr = this._userDataSubcol(userId, 'deletedProducts').doc(String(op.docId));
                    tb.set(tr, { deletedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
                });
                if (slice.length) await tb.commit();
                i += slice.length;
            }
        } catch (e) {
            console.warn('v2BatchWrite deletedProducts tombstones:', e);
        }
        await this.setUserDataMeta(userId, { schemaVersion: 2, migrationComplete: true });
        return { success: true, written };
    }
    async v2InitEmptyUserData(userId) {
        // Minimal meta doc + small settings doc; no large arrays
        await this.setUserDataMeta(userId, { schemaVersion: 2, migrationComplete: true });
        await this._userDataSubcol(userId, 'settings').doc('main').set({
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        await this._userDataSubcol(userId, 'cashDrawer').doc('summary').set({
            cashUSD: 0,
            cashLBP: 0,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return { success: true };
    }

    /** Delete all documents from subcollection (to apply data scanning with the cloud) */
    async _deleteCollectionRecursive(ref, batchSize = 400) {
        const snapshot = await ref.limit(batchSize).get();
        if (snapshot.empty) return;
        const batch = this.db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        await this._deleteCollectionRecursive(ref, batchSize);
    }

    /** Clear user data from Firestore as per specified options (V2 schema) */
    async v2ClearUserDataForClearData(userId, entities) {
        if (!userId || !entities || !Array.isArray(entities) || entities.length === 0) return { success: true };
        try {
            const subcols = ['products', 'customers', 'sales', 'suppliers', 'purchases', 'supplierPayments', 'purchaseReturns', 'supplierLedger', 'cashDrawerTx'];
            const toClear = entities.filter(e => subcols.includes(e));
            for (const entity of toClear) {
                const ref = this._userDataSubcol(userId, entity);
                await this._deleteCollectionRecursive(ref);
            }
            if (toClear.includes('products')) {
                await this._deleteCollectionRecursive(this._userDataSubcol(userId, 'deletedProducts'));
            }
            if (entities.includes('cashDrawer')) {
                await this._userDataSubcol(userId, 'cashDrawer').doc('summary').set({
                    cashUSD: 0,
                    cashLBP: 0,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
            if (entities.includes('settings')) {
                await this._userDataSubcol(userId, 'settings').doc('main').set({
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
            return { success: true };
        } catch (e) {
            console.warn('v2ClearUserDataForClearData error:', e);
            throw e;
        }
    }

    /** Wipe data V1 (userData) when a user erases data - entities to specify what is deleted, if left or all then all are deleted */
    async v1ClearUserDataDoc(userId, entities) {
        if (!userId) return { success: true };
        try {
            const payload = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
            const allEnts = ['products', 'customers', 'sales', 'suppliers', 'purchases', 'supplierPayments', 'purchaseReturns', 'supplierLedger', 'settings', 'cashDrawer'];
            const toClear = (entities && entities.length > 0 && !entities.includes('all')) ? entities : allEnts;
            if (toClear.includes('products')) payload.products = [];
            if (toClear.includes('customers')) payload.customers = [];
            if (toClear.includes('sales')) payload.sales = [];
            if (toClear.includes('suppliers')) payload.suppliers = [];
            if (toClear.includes('purchases')) payload.purchases = [];
            if (toClear.includes('supplierPayments')) payload.supplierPayments = [];
            if (toClear.includes('purchaseReturns')) payload.purchaseReturns = [];
            if (toClear.includes('supplierLedger')) payload.supplierLedger = [];
            if (toClear.includes('settings')) payload.settings = {};
            if (toClear.includes('cashDrawer')) payload.cashDrawer = { cashUSD: 0, cashLBP: 0 };
            await this.db.collection('userData').doc(userId).set(payload, { merge: true });
            return { success: true };
        } catch (e) {
            console.warn('v1ClearUserDataDoc error:', e);
            throw e;
        }
    }

    // ============ USERS COLLECTION ============

    // Get user by ID
    async getUser(uid) {
        try {
            const userDoc = await this.db.collection('users').doc(uid).get();
            if (userDoc.exists) {
                return { id: userDoc.id, ...userDoc.data() };
            }
            return null;
        } catch (error) {
            console.error('Error getting user:', error);
            throw error;
        }
    }

    // Get sub-users for a parent admin (store owner)
    async getSubUsers(parentAdminId) {
        try {
            if (!parentAdminId) return [];
            const snapshot = await this.db.collection('users')
                .where('parentAdminId', '==', parentAdminId)
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            const code = error && error.code;
            if (code === 'permission-denied') {
                console.warn('getSubUsers: permission denied — caller must be store owner (see Firestore rules).', error.message || code);
                return [];
            }
            const msg = (error && error.message) || '';
            if (code === 'unavailable' || /offline|network request failed/i.test(String(msg))) {
                console.warn('getSubUsers: offline/unavailable, returning empty list.', code || msg);
                return [];
            }
            console.error('Error getting sub-users:', error);
            throw error;
        }
    }

    // Get all users (super admin only). Do not use orderBy('createdAt') so users without createdAt are not excluded.
    async getAllUsers() {
        try {
            const snapshot = await this.db.collection('users').get();
            const users = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            // Sort by createdAt descending in memory (missing = treat as old)
            users.sort((a, b) => {
                const tA = a.createdAt && (a.createdAt.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt).getTime()) || 0;
                const tB = b.createdAt && (b.createdAt.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt).getTime()) || 0;
                return tB - tA;
            });
            return users;
        } catch (error) {
            console.error('Error getting all users:', error);
            throw error;
        }
    }

    // Update user
    async updateUser(uid, data) {
        try {
            await this.db.collection('users').doc(uid).update(data);
            return { success: true };
        } catch (error) {
            console.error('Error updating user:', error);
            throw error;
        }
    }

    // Delete user (super admin only)
    async deleteUser(uid) {
        try {
            await this.db.collection('users').doc(uid).delete();
            return { success: true };
        } catch (error) {
            console.error('Error deleting user:', error);
            throw error;
        }
    }

    // Delete all store data (userData, stores, users, subscriptions) - super admin only, requires password
    async deleteStoreData(uid) {
        try {
            const batch = [];
            const userDataRef = this.db.collection('userData').doc(uid);
            const storesRef = this.db.collection('stores').doc(uid);
            const usersRef = this.db.collection('users').doc(uid);
            const subsRef = this.db.collection('subscriptions').doc(uid);
            const emailVerificationsRef = this.db.collection('emailVerifications').doc(uid);

            const userDataSnap = await userDataRef.get();
            if (userDataSnap.exists) batch.push(userDataRef.delete());
            const storesSnap = await storesRef.get();
            if (storesSnap.exists) batch.push(storesRef.delete());
            const usersSnap = await usersRef.get();
            if (usersSnap.exists) batch.push(usersRef.delete());
            const subsSnap = await subsRef.get();
            if (subsSnap.exists) batch.push(subsRef.delete());
            const emailVerSnap = await emailVerificationsRef.get();
            if (emailVerSnap.exists) batch.push(emailVerificationsRef.delete());

            await Promise.all(batch);
            return { success: true };
        } catch (error) {
            console.error('Error deleting store data:', error);
            throw error;
        }
    }

    // Activate/Deactivate user
    async toggleUserStatus(uid, isActive) {
        try {
            await this.db.collection('users').doc(uid).update({
                isActive: isActive
            });
            return { success: true };
        } catch (error) {
            console.error('Error toggling user status:', error);
            throw error;
        }
    }

    // ============ STORES COLLECTION ============

    // Get store by ID
    async getStore(storeId) {
        try {
            const storeDoc = await this.db.collection('stores').doc(storeId).get();
            if (storeDoc.exists) {
                return { id: storeDoc.id, ...storeDoc.data() };
            }
            return null;
        } catch (error) {
            console.error('Error getting store:', error);
            throw error;
        }
    }

    // Get store by subdomain
    async getStoreBySubdomain(subdomain) {
        try {
            const snapshot = await this.db.collection('stores')
                .where('subdomain', '==', subdomain)
                .where('isActive', '==', true)
                .limit(1)
                .get();
            
            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                return { id: doc.id, ...doc.data() };
            }
            return null;
        } catch (error) {
            console.error('Error getting store by subdomain:', error);
            throw error;
        }
    }

    // Get all stores (super admin only)
    async getAllStores() {
        try {
            const snapshot = await this.db.collection('stores').orderBy('createdAt', 'desc').get();
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error getting all stores:', error);
            throw error;
        }
    }

    // Update store
    async updateStore(storeId, data) {
        try {
            await this.db.collection('stores').doc(storeId).update(data);
            return { success: true };
        } catch (error) {
            console.error('Error updating store:', error);
            throw error;
        }
    }

    // Activate/Deactivate store
    async toggleStoreStatus(storeId, isActive) {
        try {
            await this.db.collection('stores').doc(storeId).update({
                isActive: isActive
            });
            // Also update user status
            const store = await this.getStore(storeId);
            if (store && store.ownerId) {
                await this.toggleUserStatus(store.ownerId, isActive);
            }
            return { success: true };
        } catch (error) {
            console.error('Error toggling store status:', error);
            throw error;
        }
    }

    // ============ PRODUCTS COLLECTION ============

    // Get products for a store
    async getProducts(storeId) {
        try {
            const snapshot = await this.db.collection('products')
                .where('storeId', '==', storeId)
                .orderBy('createdAt', 'desc')
                .get();
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error getting products:', error);
            throw error;
        }
    }

    // Add product
    async addProduct(storeId, productData) {
        try {
            const product = {
                storeId: storeId,
                name: productData.name,
                price: productData.price,
                description: productData.description || '',
                imageUrl: productData.imageUrl || '',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            const docRef = await this.db.collection('products').add(product);
            return { success: true, id: docRef.id };
        } catch (error) {
            console.error('Error adding product:', error);
            throw error;
        }
    }

    // Update product
    async updateProduct(productId, data) {
        try {
            await this.db.collection('products').doc(productId).update(data);
            return { success: true };
        } catch (error) {
            console.error('Error updating product:', error);
            throw error;
        }
    }

    // Delete product
    async deleteProduct(productId) {
        try {
            await this.db.collection('products').doc(productId).delete();
            return { success: true };
        } catch (error) {
            console.error('Error deleting product:', error);
            throw error;
        }
    }

    // ============ ORDERS COLLECTION ============

    // Get orders for a store
    async getOrders(storeId) {
        try {
            const snapshot = await this.db.collection('orders')
                .where('storeId', '==', storeId)
                .orderBy('createdAt', 'desc')
                .get();
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error getting orders:', error);
            throw error;
        }
    }

    // Add order
    async addOrder(storeId, orderData) {
        try {
            const order = {
                storeId: storeId,
                customerName: orderData.customerName || '',
                customerPhone: orderData.customerPhone || '',
                total: orderData.total,
                status: orderData.status || 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            const docRef = await this.db.collection('orders').add(order);
            return { success: true, id: docRef.id };
        } catch (error) {
            console.error('Error adding order:', error);
            throw error;
        }
    }

    // Update order
    async updateOrder(orderId, data) {
        try {
            await this.db.collection('orders').doc(orderId).update(data);
            return { success: true };
        } catch (error) {
            console.error('Error updating order:', error);
            throw error;
        }
    }

    // Delete order
    async deleteOrder(orderId) {
        try {
            await this.db.collection('orders').doc(orderId).delete();
            return { success: true };
        } catch (error) {
            console.error('Error deleting order:', error);
            throw error;
        }
    }

    // ============ STATISTICS ============

    // Get total users count
    async getTotalUsersCount() {
        try {
            const snapshot = await this.db.collection('users').get();
            return snapshot.size;
        } catch (error) {
            console.error('Error getting users count:', error);
            throw error;
        }
    }

    // Get active users count
    async getActiveUsersCount() {
        try {
            const snapshot = await this.db.collection('users')
                .where('isActive', '==', true)
                .get();
            return snapshot.size;
        } catch (error) {
            console.error('Error getting active users count:', error);
            throw error;
        }
    }

    // ============ SERVER TIME (unifying the calculation of days on all devices) ============
    async getServerTimeMs(userId) {
        try {
            // Always touch the signed-in user's doc so rules (`request.auth.uid == docId`) pass for sub-users.
            // Server clock is identical regardless of doc id; callers may still pass owner id for legacy calls.
            const docUid = (this.auth && this.auth.currentUser && this.auth.currentUser.uid) || userId;
            if (!docUid) return null;
            const ref = this.db.collection('_serverTime').doc(String(docUid));
            await ref.set({ t: firebase.firestore.FieldValue.serverTimestamp() });
            await new Promise(r => setTimeout(r, 150));
            const snap = await ref.get({ source: 'server' });
            const data = snap.exists ? snap.data() : null;
            const t = data && data.t;
            return t && typeof t.toMillis === 'function' ? t.toMillis() : null;
        } catch (e) {
            console.warn('getServerTimeMs failed:', e);
            return null;
        }
    }

    // ============ SUBSCRIPTIONS COLLECTION ============

    // Get subscription for a user — always from the server (no cache) to ensure the same value on all devices
    async getSubscription(userId) {
        try {
            try {
                if (typeof window !== 'undefined') window.__firebaseSubReadOfflineGuess = false;
            } catch (_) {}
            const subRef = this.db.collection('subscriptions').doc(userId);
            const subDoc = await subRef.get({ source: 'server' });
            if (subDoc.exists) {
                return { id: subDoc.id, ...subDoc.data() };
            }
            return null;
        } catch (error) {
            if (error.code === 'permission-denied') {
                console.warn('Permission denied reading subscription (may not exist yet)');
                return null;
            }
            const msg = (error.message || '').toString().toLowerCase();
            if (error.code === 'unavailable' ||
                error.code === 'deadline-exceeded' ||
                (error.message && (msg.includes('network') || msg.includes('offline') || msg.includes('client is offline') || msg.includes('failed to get document')))) {
                try {
                    if (typeof window !== 'undefined') window.__firebaseSubReadOfflineGuess = true;
                } catch (_) {}
                // We do not print a warning when offline - this is normal
                return null;
            }
            console.error('Error getting subscription:', error);
            throw error;
        }
    }

    // To verify activation only: the server tries first, and if it returns null or fails, it tries the cache (so that it does not appear “inactivated” for a lifetime subscription when the network is slow/interrupted)
    async getSubscriptionForActivationCheck(userId) {
        let fromServer = null;
        try {
            fromServer = await this.getSubscription(userId);
            if (fromServer) return fromServer;
        } catch (e) {
            // Server failed - we try the cache
        }
        const subRef = this.db.collection('subscriptions').doc(userId);
        // Explicit reading from the cache first (when offline, an error is not raised to the caller if a local copy exists)
        try {
            const fromCache = await subRef.get({ source: 'cache' });
            if (fromCache.exists) {
                const data = { id: fromCache.id, ...fromCache.data() };
                if (data.activated || data.lifetime) return data;
            }
        } catch (_) {}
        try {
            const subDoc = await subRef.get({ source: 'default' });
            if (subDoc.exists) {
                const data = { id: subDoc.id, ...subDoc.data() };
                if (data.activated || data.lifetime) return data;
            }
        } catch (_) {}
        return fromServer;
    }

    // Legacy direct subscription mutation is disabled.
    // Subscription activation is managed by Super Admin only (adminSetSubscriptionSecure).
    async setSubscription(userId, subscriptionData) {
        throw new Error('Direct client subscription writes are disabled. Use secure subscription functions.');
    }

    // Legacy direct subscription extension is disabled.
    // Super admin should use adminSetSubscriptionSecure({ action: "extend" }).
    async extendSubscription(userId, daysToAdd) {
        throw new Error('Direct client subscription extension is disabled. Use secure admin subscription actions.');
    }

    // Get all subscriptions (super admin only) — always from the server (no cache)
    async getAllSubscriptions() {
        try {
            const colRef = this.db.collection('subscriptions');
            const snapshot = await colRef.get({ source: 'server' });
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error getting all subscriptions:', error);
            throw error;
        }
    }

    // Get users with subscription data (for admin dashboard)
    async getUsersWithSubscriptions() {
        try {
            const users = await this.getAllUsers();
            const subscriptions = await this.getAllSubscriptions();
            
            const subscriptionMap = {};
            subscriptions.forEach(sub => {
                subscriptionMap[sub.userId] = sub;
            });

            return users.map(user => {
                const subscription = subscriptionMap[user.id] || null;
                return {
                    ...user,
                    subscription: subscription
                };
            });
        } catch (error) {
            console.error('Error getting users with subscriptions:', error);
            throw error;
        }
    }

    async adminListUsersSecure(search = '', limit = 200) {
        const data = await this.callSecureAdminFunction('adminListUsers', {
            search: String(search || ''),
            limit: Number(limit) || 200
        });
        return data && Array.isArray(data.users) ? data.users : [];
    }

    async adminSetSubscriptionSecure(payload) {
        return await this.callSecureAdminFunction('adminSetSubscription', payload || {});
    }

    async adminDeleteUserAccountSecure(uid) {
        const targetUid = String(uid || '').trim();
        if (!targetUid) throw new Error('User id is required');
        return await this.callSecureAdminHttpFunction('deleteAuthUserBySuperAdmin', { uid: targetUid });
    }

    async runAiInsightsNowSecure() {
        return await this.callSecureAdminFunction('runAiInsightsNow', {});
    }

    async extractProductFromSpeechSecure(payload) {
        return { disabled: true, useClientFallback: false, message: 'Voice feature removed' };
    }

    async extractInvoiceFromImageSecure(payload) {
        return await this.callSecureAdminFunction('extractInvoiceFromImageSecure', payload || {});
    }

    async adminRecalculateUsageStatsSecure(payload) {
        // Best-effort operation:
        // - On hosted web.app/firebaseapp.com, prefer callable to avoid CORS edge cases.
        // - On local/dev, try HTTP endpoint first then fallback to callable.
        const host = (typeof window !== 'undefined' && window.location && window.location.hostname)
            ? String(window.location.hostname).toLowerCase()
            : '';
        const isHostedWeb = /\.web\.app$|\.firebaseapp\.com$/.test(host);
        try {
            if (isHostedWeb) {
                return await this.callSecureAdminFunction('adminRecalculateUsageStats', payload || {});
            }
            return await this.callSecureAdminHttpFunction('adminRecalculateUsageStatsHttp', payload || {});
        } catch (primaryError) {
            try {
                if (isHostedWeb) {
                    return await this.callSecureAdminHttpFunction('adminRecalculateUsageStatsHttp', payload || {});
                }
                return await this.callSecureAdminFunction('adminRecalculateUsageStats', payload || {});
            } catch (secondaryError) {
                const msg = String(primaryError && (primaryError.message || primaryError.code || primaryError) || '') + ' ' +
                    String(secondaryError && (secondaryError.message || secondaryError.code || secondaryError) || '');
                const isNetworkOrCors = /failed to fetch|networkerror|cors|load failed|net::err_failed/i.test(msg);
                if (isNetworkOrCors) {
                    this._logThrottled(
                        'info',
                        'adminRecalculateUsageStatsSecure_network_or_cors',
                        'adminRecalculateUsageStatsSecure: endpoints unavailable (network/CORS); skipping best-effort recalc'
                    );
                    return { ok: false, skipped: true, reason: 'network_or_cors' };
                }
                if (secondaryError) {
                    this._logThrottled(
                        'warn',
                        'adminRecalculateUsageStatsSecure_failed',
                        'adminRecalculateUsageStats failed:',
                        secondaryError
                    );
                }
                throw primaryError;
            }
        }
    }

    async activateSubscriptionCodeSecure(code) {
        throw new Error('Self-service activation is disabled. Contact Super Admin.');
    }

    async claimFreeMonthSecure() {
        throw new Error('Self-service activation is disabled. Contact Super Admin.');
    }

    async bootstrapSuperAdminAccessSecure() {
        return await this.callSecureAdminFunction('bootstrapSuperAdminAccess', {});
    }

    // ============ APP UPDATE CONTROL ============
    async getAppUpdateControl() {
        try {
            const doc = await this.db.collection('appControl').doc('update').get({ source: 'server' });
            return doc.exists ? (doc.data() || {}) : null;
        } catch (error) {
            console.warn('getAppUpdateControl failed:', error && (error.message || error.code || error));
            return null;
        }
    }

    async setPendingAppUpdate(payload = {}) {
        const versionCode = Number(payload.versionCode || 0);
        if (!versionCode) throw new Error('versionCode is required');
        try {
            return await this.callSecureAdminFunction('adminPrepareAppUpdate', payload || {});
        } catch (_) {
            // Backward compatibility fallback for older deployments.
            const versionLabel = String(payload.versionLabel || '1.0.0');
            await this.db.collection('appControl').doc('update').set({
                pendingVersionCode: versionCode,
                pendingVersionLabel: versionLabel,
                pendingAt: firebase.firestore.FieldValue.serverTimestamp(),
                pendingBy: (this.auth && this.auth.currentUser && this.auth.currentUser.uid) || null
            }, { merge: true });
            return { success: true };
        }
    }

    async releasePendingAppUpdate(payload = {}) {
        const versionCode = Number(payload.versionCode || 0);
        if (!versionCode && !payload.forceReleasePending) throw new Error('versionCode is required');
        try {
            return await this.callSecureAdminFunction('adminReleaseAppUpdate', payload || {});
        } catch (_) {
            // Backward compatibility fallback for older deployments.
            const versionLabel = String(payload.versionLabel || '1.0.0');
            await this.db.collection('appControl').doc('update').set({
                releasedVersionCode: versionCode,
                releasedVersionLabel: versionLabel,
                releasedAt: firebase.firestore.FieldValue.serverTimestamp(),
                releasedBy: (this.auth && this.auth.currentUser && this.auth.currentUser.uid) || null,
                pendingVersionCode: versionCode,
                pendingVersionLabel: versionLabel
            }, { merge: true });
            return { success: true };
        }
    }

    async adminPrepareAppUpdateSecure(payload = {}) {
        return await this.callSecureAdminFunction('adminPrepareAppUpdate', payload || {});
    }

    async adminReleaseAppUpdateSecure(payload = {}) {
        return await this.callSecureAdminFunction('adminReleaseAppUpdate', payload || {});
    }

    async testPublishToAllUsersSecure(payload = {}) {
        return await this.callSecureAdminFunction('testPublishToAllUsers', payload || {});
    }

    async listAppUpdateTargetUsersSecure(search = '', limit = 100) {
        return await this.callSecureAdminFunction('listAppUpdateTargetUsers', {
            search: String(search || ''),
            limit: Number(limit) || 100
        });
    }

    async adminCreateDemoAccountSecure(payload = {}) {
        return await this.callSecureAdminFunction('adminCreateDemoAccount', payload || {});
    }

    async adminSetUpdateChannelsSecure(payload = {}) {
        return await this.callSecureAdminFunction('adminSetUpdateChannels', payload || {});
    }

    async adminEmergencyStopUpdatesSecure(payload = {}) {
        return await this.callSecureAdminFunction('adminEmergencyStopUpdates', payload || {});
    }

    async adminGetUpdateStatusDashboardSecure(payload = {}) {
        return await this.callSecureAdminFunction('adminGetUpdateStatusDashboard', payload || {});
    }

    async adminGetDeploymentStatusSecure(payload = {}) {
        return await this.callSecureAdminFunction('adminGetDeploymentStatus', payload || {});
    }

    async adminNormalizeAppVersionBaselineSecure(payload = {}) {
        return await this.callSecureAdminFunction('adminNormalizeAppVersionBaseline', payload || {});
    }

    async adminPromoteTestBuildToProductionSecure(payload = {}) {
        return await this.callSecureAdminFunction('adminPromoteTestBuildToProduction', payload || {});
    }

    async reportClientUpdateStatusSecure(payload = {}) {
        return await this.callSecureAdminFunction('reportClientUpdateStatus', payload || {});
    }

    subscribeAppUpdateControl(callback) {
        if (!this.db || typeof callback !== 'function') return () => {};
        return this.db.collection('appControl').doc('update').onSnapshot(
            (doc) => callback(doc && doc.exists ? (doc.data() || {}) : null),
            (error) => {
                const code = String(error && error.code ? error.code : '');
                const msg = error && (error.message || error.code || error);
                if (code === 'permission-denied') {
                    this._logThrottled(
                        'info',
                        'subscribeAppUpdateControl_permission_denied',
                        'subscribeAppUpdateControl denied for current role.'
                    );
                    return;
                }
                this._logThrottled('warn', 'subscribeAppUpdateControl_error', 'subscribeAppUpdateControl error:', msg, 60000);
            }
        );
    }

    // ============ FEATURE FLAGS CONTROL ============
    async getFeatureFlagsControl() {
        try {
            const doc = await this.db.collection('appControl').doc('features').get({ source: 'server' });
            return doc.exists ? (doc.data() || {}) : {};
        } catch (error) {
            console.warn('getFeatureFlagsControl failed:', error && (error.message || error.code || error));
            return {};
        }
    }

    subscribeFeatureFlagsControl(callback) {
        if (!this.db || typeof callback !== 'function') return () => {};
        return this.db.collection('appControl').doc('features').onSnapshot(
            (doc) => callback(doc && doc.exists ? (doc.data() || {}) : {}),
            (error) => {
                const code = String(error && error.code ? error.code : '');
                const msg = error && (error.message || error.code || error);
                if (code === 'permission-denied') {
                    this._logThrottled(
                        'info',
                        'subscribeFeatureFlagsControl_permission_denied',
                        'subscribeFeatureFlagsControl denied for current role.'
                    );
                    callback({});
                    return;
                }
                this._logThrottled('warn', 'subscribeFeatureFlagsControl_error', 'subscribeFeatureFlagsControl error:', msg, 60000);
            }
        );
    }

    // Super admin only (enforced by Firestore rules on appControl collection)
    async setFeatureFlagConfig(flagKey, config = {}) {
        const key = String(flagKey || '').trim();
        if (!key) throw new Error('flagKey is required');
        const safeConfig = (config && typeof config === 'object') ? config : {};
        await this.db.collection('appControl').doc('features').set({
            featureFlags: {
                [key]: {
                    ...safeConfig,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: (this.auth && this.auth.currentUser && this.auth.currentUser.uid) || null
                }
            }
        }, { merge: true });
        return { success: true };
    }

    async resolveFeatureFlagsSecure(payload = {}) {
        return await this.callSecureAdminFunction('resolveFeatureFlags', payload || {});
    }

    async trackObservabilityEventSecure(payload = {}) {
        try {
            return await this.callSecureAdminFunction('trackObservabilityEvent', payload || {});
        } catch (error) {
            return { ok: false, skipped: true, reason: String(error && (error.message || error.code || error)) };
        }
    }

    async getSystemObservabilityMetricsSecure(payload = {}) {
        return await this.callSecureAdminFunction('getSystemObservabilityMetrics', payload || {});
    }

    async clearSystemErrorLogsSecure(payload = {}) {
        return await this.callSecureAdminFunction('clearSystemErrorLogs', payload || {});
    }

    // ============ USAGE STATS ============
    async upsertUsageStats(ownerId, stats = {}) {
        if (!ownerId) return { success: false, skipped: true };
        const bytes = Math.max(0, Number(stats.bytes || 0));
        const mb = bytes / (1024 * 1024);
        await this.db.collection('usageStats').doc(String(ownerId)).set({
            ownerId: String(ownerId),
            bytes: bytes,
            megaBytes: Number(mb.toFixed(3)),
            actorUid: (this.auth && this.auth.currentUser && this.auth.currentUser.uid) || null,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return { success: true };
    }

    subscribeUsageStats(callback, options = {}) {
        if (!this.db || typeof callback !== 'function') return () => {};
        const all = !!(options && options.all);
        const ownerId = String((options && options.ownerId) || (this.auth && this.auth.currentUser && this.auth.currentUser.uid) || '').trim();

        const subscribeOwnerDoc = (id) => {
            if (!id) {
                callback({});
                return () => {};
            }
            return this.db.collection('usageStats').doc(id).onSnapshot(
                (doc) => {
                    const out = {};
                    if (doc && doc.exists) out[doc.id] = doc.data() || {};
                    callback(out);
                },
                (error) => {
                    const code = String(error && error.code ? error.code : '');
                    const msg = error && (error.message || error.code || error);
                    if (code === 'permission-denied') {
                        this._logThrottled(
                            'info',
                            'subscribeUsageStats_owner_doc_permission_denied',
                            'subscribeUsageStats owner-doc denied for current role.'
                        );
                        callback({});
                        return;
                    }
                    this._logThrottled('warn', 'subscribeUsageStats_owner_doc_error', 'subscribeUsageStats owner-doc error:', msg, 60000);
                }
            );
        };

        if (!all) return subscribeOwnerDoc(ownerId);

        let nestedUnsub = null;
        const primaryUnsub = this.db.collection('usageStats').onSnapshot(
            (snap) => {
                const out = {};
                snap.forEach((doc) => {
                    out[doc.id] = doc.data() || {};
                });
                callback(out);
            },
            (error) => {
                const code = String(error && error.code ? error.code : '');
                if (code === 'permission-denied') {
                    this._logThrottled(
                        'info',
                        'subscribeUsageStats_list_permission_denied',
                        'subscribeUsageStats list denied; falling back to owner doc'
                    );
                    if (!nestedUnsub) nestedUnsub = subscribeOwnerDoc(ownerId);
                    return;
                }
                this._logThrottled(
                    'warn',
                    'subscribeUsageStats_list_error',
                    'subscribeUsageStats error:',
                    error && (error.message || error.code || error),
                    60000
                );
            }
        );
        return () => {
            try { if (typeof primaryUnsub === 'function') primaryUnsub(); } catch (_) {}
            try { if (typeof nestedUnsub === 'function') nestedUnsub(); } catch (_) {}
        };
    }

    // ============ USER DATA COLLECTIONS ============
    // Save and load user-specific data (products, customers, sales, etc.)

    // Save products for a user
    async saveUserProducts(userId, products) {
        try {
            if (!userId) throw new Error('UserId is required');
            await this.db.collection('userData').doc(userId).set({
                products: products,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return { success: true };
        } catch (error) {
            console.error('Error saving user products:', error);
            throw error;
        }
    }

    // Load products for a user
    async loadUserProducts(userId) {
        try {
            if (!userId) throw new Error('UserId is required');
            const doc = await this.db.collection('userData').doc(userId).get();
            if (doc.exists) {
                return doc.data().products || [];
            }
            return [];
        } catch (error) {
            console.error('Error loading user products:', error);
            throw error;
        }
    }

    // Save customers for a user
    async saveUserCustomers(userId, customers) {
        try {
            if (!userId) throw new Error('UserId is required');
            await this.db.collection('userData').doc(userId).set({
                customers: customers,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return { success: true };
        } catch (error) {
            console.error('Error saving user customers:', error);
            throw error;
        }
    }

    // Load customers for a user
    async loadUserCustomers(userId) {
        try {
            if (!userId) throw new Error('UserId is required');
            const doc = await this.db.collection('userData').doc(userId).get();
            if (doc.exists) {
                return doc.data().customers || [];
            }
            return [];
        } catch (error) {
            console.error('Error loading user customers:', error);
            throw error;
        }
    }

    // Save sales for a user
    async saveUserSales(userId, sales) {
        try {
            if (!userId) throw new Error('UserId is required');
            await this.db.collection('userData').doc(userId).set({
                sales: sales,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return { success: true };
        } catch (error) {
            console.error('Error saving user sales:', error);
            throw error;
        }
    }

    // Load sales for a user
    async loadUserSales(userId) {
        try {
            if (!userId) throw new Error('UserId is required');
            const doc = await this.db.collection('userData').doc(userId).get();
            if (doc.exists) {
                return doc.data().sales || [];
            }
            return [];
        } catch (error) {
            console.error('Error loading user sales:', error);
            throw error;
        }
    }

    // Save suppliers for a user
    async saveUserSuppliers(userId, suppliers) {
        try {
            if (!userId) throw new Error('UserId is required');
            await this.db.collection('userData').doc(userId).set({
                suppliers: suppliers,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return { success: true };
        } catch (error) {
            console.error('Error saving user suppliers:', error);
            throw error;
        }
    }

    // Load suppliers for a user
    async loadUserSuppliers(userId) {
        try {
            if (!userId) throw new Error('UserId is required');
            const doc = await this.db.collection('userData').doc(userId).get();
            if (doc.exists) {
                return doc.data().suppliers || [];
            }
            return [];
        } catch (error) {
            console.error('Error loading user suppliers:', error);
            throw error;
        }
    }

    // Save purchases for a user
    async saveUserPurchases(userId, purchases) {
        try {
            if (!userId) throw new Error('UserId is required');
            await this.db.collection('userData').doc(userId).set({
                purchases: purchases,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return { success: true };
        } catch (error) {
            console.error('Error saving user purchases:', error);
            throw error;
        }
    }

    // Load purchases for a user
    async loadUserPurchases(userId) {
        try {
            if (!userId) throw new Error('UserId is required');
            const doc = await this.db.collection('userData').doc(userId).get();
            if (doc.exists) {
                return doc.data().purchases || [];
            }
            return [];
        } catch (error) {
            console.error('Error loading user purchases:', error);
            throw error;
        }
    }

    // Save cash drawer for a user
    async saveUserCashDrawer(userId, cashDrawer) {
        try {
            if (!userId) throw new Error('UserId is required');
            await this.db.collection('userData').doc(userId).set({
                cashDrawer: cashDrawer,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return { success: true };
        } catch (error) {
            console.error('Error saving user cash drawer:', error);
            throw error;
        }
    }

    // Shared tenant cashbox summary (single balance for all users in the same tenant)
    async saveTenantCashboxSummary(tenantId, summary) {
        try {
            if (!tenantId) throw new Error('TenantId is required');
            const cd = summary || {};
            const toUSDCents = (v) => Math.round((Number(v) || 0) * 100);
            const toLBPUnits = (v) => Math.round(Number(v) || 0);
            const fromUSDCents = (v) => (Number(v) || 0) / 100;

            const targetUSDCents = toUSDCents(cd.cashUSD);
            const targetLBPUnits = toLBPUnits(cd.cashLBP);
            const baseUSDCents = Number.isFinite(Number(cd.baseCashUSDCents))
                ? Number(cd.baseCashUSDCents)
                : null;
            const baseLBPUnits = Number.isFinite(Number(cd.baseCashLBPUnits))
                ? Number(cd.baseCashLBPUnits)
                : null;
            const operationIdRaw = String(cd.operationId || '').trim();
            const operationId = operationIdRaw ? operationIdRaw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) : null;

            const ref = this.db.collection('cashbox').doc(String(tenantId));
            await this.db.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                const data = snap.exists ? (snap.data() || {}) : {};
                const currentUSDCents = Number.isFinite(Number(data.cashUSDCents))
                    ? Number(data.cashUSDCents)
                    : Math.round((Number(data.cashUSD || 0) || 0) * 100);
                const currentLBPUnits = Number.isFinite(Number(data.cashLBPUnits))
                    ? Number(data.cashLBPUnits)
                    : Math.round(Number(data.cashLBP || 0) || 0);

                let nextUSDCents = targetUSDCents;
                let nextLBPUnits = targetLBPUnits;
                const recentOperationIds = Array.isArray(data.recentOperationIds) ? data.recentOperationIds : [];

                if (operationId && recentOperationIds.includes(operationId)) {
                    return;
                }

                // Conflict-safe path: apply delta against current cloud value.
                if (baseUSDCents !== null && baseLBPUnits !== null) {
                    const deltaUSDCents = targetUSDCents - baseUSDCents;
                    const deltaLBPUnits = targetLBPUnits - baseLBPUnits;
                    nextUSDCents = currentUSDCents + deltaUSDCents;
                    nextLBPUnits = currentLBPUnits + deltaLBPUnits;
                }

                tx.set(ref, {
                    tenantId: String(tenantId),
                    cashUSDCents: Math.round(nextUSDCents),
                    cashLBPUnits: Math.round(nextLBPUnits),
                    // Legacy mirrors for backward compatibility while migrating reads.
                    cashUSD: fromUSDCents(nextUSDCents),
                    cashLBP: Math.round(nextLBPUnits),
                    recentOperationIds: operationId
                        ? [...recentOperationIds, operationId].slice(-200)
                        : recentOperationIds,
                    lastUpdate: cd.lastUpdate || new Date().toISOString(),
                    updatedBy: (this.auth && this.auth.currentUser && this.auth.currentUser.uid) || null,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            });
            return { success: true };
        } catch (error) {
            console.error('Error saving tenant cashbox summary:', error);
            throw error;
        }
    }

    // Backward-compatible wrapper
    async saveCashDrawerSummary(userIdOrTenantId, summary) {
        return this.saveTenantCashboxSummary(userIdOrTenantId, summary);
    }

    // V2: Get next sale id and invoice number via Firestore Transaction (prevents duplicate invoice numbers across devices)
    // prefix: 'INV' (default), 'RF' (refund), or 'CR' (credit)
    async getNextSaleId(userId, prefix = 'INV') {
        try {
            if (!userId) throw new Error('UserId is required');
            const self = this;
            const safePrefix = (prefix === 'RF' ? 'RF' : (prefix === 'CR' ? 'CR' : 'INV'));
            return await this.db.runTransaction(async (transaction) => {
                const ref = self._userDataSubcol(userId, 'counters').doc('sales');
                const doc = await transaction.get(ref);
                const current = (doc.exists && doc.data() && typeof doc.data().nextId === 'number') ? doc.data().nextId : 0;
                const nextId = current + 1;
                transaction.set(ref, {
                    nextId: nextId,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                return {
                    id: nextId,
                    invoiceNumber: safePrefix + '-' + String(nextId).padStart(3, '0')
                };
            });
        } catch (error) {
            // 429 / resource-exhausted = Firestore quota exhausted (common on free plans)
            const isQuota = (error && (error.code === 'resource-exhausted' || (error.message && error.message.includes('Quota'))));
            if (isQuota) {
                console.warn('getNextSaleId: Firestore quota exceeded, use local invoice number.');
            } else {
                console.error('getNextSaleId failed:', error);
            }
            throw error;
        }
    }

    // Get shared tenant cashbox summary from cloud (for sync across devices/users)
    async getTenantCashboxSummary(tenantId) {
        try {
            if (!tenantId) return null;
            // Try from the server first
            try {
                const doc = await this.db.collection('cashbox').doc(String(tenantId)).get({ source: 'server' });
                if (doc.exists) {
                    const d = doc.data() || {};
                    return {
                        cashUSD: Number.isFinite(Number(d.cashUSDCents))
                            ? Number(d.cashUSDCents) / 100
                            : Number(d.cashUSD || 0),
                        cashLBP: Number.isFinite(Number(d.cashLBPUnits))
                            ? Number(d.cashLBPUnits)
                            : Number(d.cashLBP || 0),
                        cashUSDCents: Number.isFinite(Number(d.cashUSDCents))
                            ? Number(d.cashUSDCents)
                            : Math.round((Number(d.cashUSD || 0) || 0) * 100),
                        cashLBPUnits: Number.isFinite(Number(d.cashLBPUnits))
                            ? Number(d.cashLBPUnits)
                            : Math.round(Number(d.cashLBP || 0) || 0),
                        lastUpdate: d.lastUpdate || null,
                        updatedAt: d.updatedAt != null ? d.updatedAt : null,
                        tenantId: d.tenantId || String(tenantId)
                    };
                }
            } catch (serverError) {
                // If the client is offline, we try cache
                if (serverError.code === 'unavailable' || serverError.message?.includes('offline')) {
                    try {
                        const cachedDoc = await this.db.collection('cashbox').doc(String(tenantId)).get({ source: 'cache' });
                        if (cachedDoc.exists) {
                            const d = cachedDoc.data() || {};
                            console.log('📦 Using cached tenant cashbox summary (offline mode)');
                            return {
                                cashUSD: Number.isFinite(Number(d.cashUSDCents))
                                    ? Number(d.cashUSDCents) / 100
                                    : Number(d.cashUSD || 0),
                                cashLBP: Number.isFinite(Number(d.cashLBPUnits))
                                    ? Number(d.cashLBPUnits)
                                    : Number(d.cashLBP || 0),
                                cashUSDCents: Number.isFinite(Number(d.cashUSDCents))
                                    ? Number(d.cashUSDCents)
                                    : Math.round((Number(d.cashUSD || 0) || 0) * 100),
                                cashLBPUnits: Number.isFinite(Number(d.cashLBPUnits))
                                    ? Number(d.cashLBPUnits)
                                    : Math.round(Number(d.cashLBP || 0) || 0),
                                lastUpdate: d.lastUpdate || null,
                                updatedAt: d.updatedAt != null ? d.updatedAt : null,
                                tenantId: d.tenantId || String(tenantId)
                            };
                        }
                    } catch (cacheError) {
                        // No cache — return null quietly
                    }
                }
                // For other errors, we print a warning only if it is not offline
                if (serverError.code !== 'unavailable' && !serverError.message?.includes('offline')) {
                    console.warn('getCashDrawerSummary failed:', serverError);
                }
            }
            return null;
        } catch (error) {
            // Unexpected error
            if (error.code !== 'unavailable' && !error.message?.includes('offline')) {
                console.warn('getCashDrawerSummary failed:', error);
            }
            return null;
        }
    }

    // Backward-compatible wrapper
    async getCashDrawerSummary(userIdOrTenantId) {
        return this.getTenantCashboxSummary(userIdOrTenantId);
    }

    subscribeTenantCashboxSummary(tenantId, callback) {
        if (!this.db || typeof callback !== 'function') return () => {};
        if (!tenantId) {
            callback(null);
            return () => {};
        }
        return this.db.collection('cashbox').doc(String(tenantId)).onSnapshot(
            (doc) => callback(doc && doc.exists ? (doc.data() || null) : null),
            (error) => console.warn('subscribeTenantCashboxSummary error:', error && (error.message || error.code || error))
        );
    }

    // Load cash drawer for a user
    async loadUserCashDrawer(userId) {
        try {
            if (!userId) throw new Error('UserId is required');
            const doc = await this.db.collection('userData').doc(userId).get();
            if (doc.exists) {
                return doc.data().cashDrawer || { transactions: [] };
            }
            return { transactions: [] };
        } catch (error) {
            console.error('Error loading user cash drawer:', error);
            throw error;
        }
    }

    /** Only settings + cash drawer (e.g. autoBackup / runFirestoreSaveWithRetry) — never bulk collections. */
    _isLiteSaveAllUserDataPayload(data) {
        if (!data || typeof data !== 'object') return false;
        const keys = Object.keys(data);
        if (!keys.length) return false;
        const allowed = new Set(['settings', 'cashDrawer']);
        return keys.every((k) => allowed.has(k));
    }

    /** V2 path: root meta + settings/main + cashDrawer/summary only (no giant root arrays). */
    async _persistUserDataV2ScopedOnly(userId, data) {
        await this.setUserDataMeta(userId, { schemaVersion: 2, migrationComplete: true });
        if (data && data.settings) {
            await this._userDataSubcol(userId, 'settings').doc('main').set({
                ...data.settings,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
        if (data && data.cashDrawer) {
            const cd = data.cashDrawer || {};
            await this._userDataSubcol(userId, 'cashDrawer').doc('summary').set({
                cashUSD: Number(cd.cashUSD || 0),
                cashLBP: Number(cd.cashLBP || 0),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
    }

    // Save all user data at once
    async saveAllUserData(userId, data) {
        try {
            if (!userId) throw new Error('UserId is required');
            // Lite saves: skip getUserDataMeta (read can fail for some scopes) and never use legacy root merge.
            if (this._isLiteSaveAllUserDataPayload(data)) {
                await this._persistUserDataV2ScopedOnly(userId, data);
                return { success: true, mode: 'v2-lite' };
            }
            const meta = await this.getUserDataMeta(userId);
            // V2: do NOT write huge arrays into the root doc (avoids 1MiB doc limit)
            if (meta && Number(meta.schemaVersion || 1) >= 2) {
                await this._persistUserDataV2ScopedOnly(userId, data);
                return { success: true, mode: 'v2-meta-only' };
            }
            const userData = {
                products: data.products || [],
                customers: data.customers || [],
                sales: data.sales || [],
                suppliers: data.suppliers || [],
                purchases: data.purchases || [],
                cashDrawer: data.cashDrawer || { transactions: [] },
                settings: data.settings || {},
                supplierPayments: data.supplierPayments || [],
                purchaseReturns: data.purchaseReturns || [],
                supplierLedger: data.supplierLedger || [],
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            };
            await this.db.collection('userData').doc(userId).set(userData, { merge: true });
            return { success: true };
        } catch (error) {
            const code = error && error.code;
            const msg = (error && error.message) || '';
            if (code === 'unavailable' || /client is offline|offline|network request failed/i.test(String(msg))) {
                console.warn('saveAllUserData: deferred (offline/unavailable):', code || msg);
            } else {
                console.error('Error saving all user data:', error);
            }
            throw error;
        }
    }

    // Load all user data at once
    async loadAllUserData(userId) {
        try {
            if (!userId) throw new Error('UserId is required');
            const meta = await this.getUserDataMeta(userId);
            if (meta && Number(meta.schemaVersion || 1) >= 2) {
                // V2: data lives in subcollections; caller should use dedicated loaders (or local DB)
                const settingsDoc = await this._userDataSubcol(userId, 'settings').doc('main').get();
                const cashDoc = await this._userDataSubcol(userId, 'cashDrawer').doc('summary').get();
                return {
                    products: [],
                    customers: [],
                    sales: [],
                    suppliers: [],
                    purchases: [],
                    cashDrawer: cashDoc.exists ? (cashDoc.data() || { transactions: [] }) : { transactions: [] },
                    settings: settingsDoc.exists ? (settingsDoc.data() || {}) : {},
                    supplierPayments: [],
                    purchaseReturns: [],
                    supplierLedger: [],
                    __schemaVersion: 2
                };
            }
            const doc = await this.db.collection('userData').doc(userId).get();
            if (doc.exists) {
                const data = doc.data();
                return {
                    products: data.products || [],
                    customers: data.customers || [],
                    sales: data.sales || [],
                    suppliers: data.suppliers || [],
                    purchases: data.purchases || [],
                    cashDrawer: data.cashDrawer || { transactions: [] },
                    settings: data.settings || {},
                    supplierPayments: data.supplierPayments || [],
                    purchaseReturns: data.purchaseReturns || [],
                    supplierLedger: data.supplierLedger || []
                };
            }
            return {
                products: [],
                customers: [],
                sales: [],
                suppliers: [],
                purchases: [],
                cashDrawer: { transactions: [] },
                settings: {},
                supplierPayments: [],
                purchaseReturns: [],
                supplierLedger: []
            };
        } catch (error) {
            const code = error && error.code;
            const msg = String((error && error.message) || '');
            if (code === 'permission-denied' || /missing or insufficient permissions|permission-denied/i.test(msg)) {
                __loadAllUserDataPermissionWarned = true;
                return {
                    products: [],
                    customers: [],
                    sales: [],
                    suppliers: [],
                    purchases: [],
                    cashDrawer: { transactions: [] },
                    settings: {},
                    supplierPayments: [],
                    purchaseReturns: [],
                    supplierLedger: [],
                    __schemaVersion: 2,
                    __restricted: true
                };
            }
            console.error('Error loading all user data:', error);
            throw error;
        }
    }
}

// Initialize Firebase DB
let firebaseDbInstance = null;
let __loadAllUserDataPermissionWarned = false;

if (typeof firebase !== 'undefined' && window.firebaseDb) {
    firebaseDbInstance = new FirebaseDB();
    window.firebaseDbInstance = firebaseDbInstance;
} else {
    console.warn('Firebase DB not initialized. Please check firebase-config.js');
}


