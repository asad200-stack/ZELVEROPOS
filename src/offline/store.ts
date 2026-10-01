import type { OfflineOperation } from './types';

/** Durable storage for queued operations. Every change is a single atomic IndexedDB transaction. */
export interface OperationStore {
  list(): Promise<OfflineOperation[]>;
  get(id: string): Promise<OfflineOperation | undefined>;
  /** Inserts a new operation; rejects if the id already exists (an operation is never overwritten). */
  add(op: OfflineOperation): Promise<void>;
  /**
   * Read-modify-write in ONE transaction: `fn` gets the current record and returns the new one, or
   * null to leave it untouched. Used to claim operations (compare-and-set) so two tabs can't both win.
   */
  mutate(id: string, fn: (current: OfflineOperation) => OfflineOperation | null): Promise<OfflineOperation | null>;
  remove(id: string): Promise<void>;
  /**
   * Sync lease shared by all tabs: granted if free, expired, or already held by `owner` (renewal).
   * A tab that crashes simply stops renewing, and the lease expires after `ttlMs`.
   */
  acquireLease(owner: string, now: number, ttlMs: number): Promise<boolean>;
  releaseLease(owner: string): Promise<void>;
  close(): void;
}

export interface SyncLease {
  id: 'sync';
  owner: string;
  expiresAt: number;
}

const DB_NAME = 'zelvero-offline';
const DB_VERSION = 1;
const OPS = 'operations';
const META = 'meta';

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

export function openOperationStore(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<OperationStore> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OPS)) {
        const store = db.createObjectStore(OPS, { keyPath: 'id' });
        store.createIndex('tenantId', 'tenantId');
        store.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
    req.onsuccess = () => resolve(wrap(req.result));
  });
}

/** Runs `fn` on the current value of `key` and writes its result, all inside one readwrite transaction. */
function readModifyWrite<T>(db: IDBDatabase, storeName: string, key: string, fn: (current: T | undefined) => T | null): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite', { durability: 'strict' });
    const store = tx.objectStore(storeName);
    let next: T | null = null;
    const getReq = store.get(key) as IDBRequest<T | undefined>;
    getReq.onsuccess = () => {
      try {
        next = fn(getReq.result);
      } catch (e) {
        tx.abort();
        reject(e);
        return;
      }
      if (next) store.put(next);
    };
    tx.oncomplete = () => resolve(next);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function wrap(db: IDBDatabase): OperationStore {
  // Another tab upgrading the schema: close so it isn't blocked; this tab reopens on next load.
  db.onversionchange = () => db.close();

  return {
    async list() {
      const tx = db.transaction(OPS, 'readonly');
      const all = await promisify(tx.objectStore(OPS).getAll() as IDBRequest<OfflineOperation[]>);
      return all.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },
    async get(id) {
      const tx = db.transaction(OPS, 'readonly');
      return promisify(tx.objectStore(OPS).get(id) as IDBRequest<OfflineOperation | undefined>);
    },
    async add(op) {
      const tx = db.transaction(OPS, 'readwrite', { durability: 'strict' });
      tx.objectStore(OPS).add(op);
      await done(tx);
    },
    mutate(id, fn) {
      return readModifyWrite<OfflineOperation>(db, OPS, id, (cur) => (cur ? fn(cur) : null));
    },
    async remove(id) {
      const tx = db.transaction(OPS, 'readwrite');
      tx.objectStore(OPS).delete(id);
      await done(tx);
    },
    async acquireLease(owner, now, ttlMs) {
      const granted = await readModifyWrite<SyncLease>(db, META, 'sync', (cur) =>
        !cur || cur.owner === owner || cur.expiresAt <= now ? { id: 'sync', owner, expiresAt: now + ttlMs } : null,
      );
      return granted !== null;
    },
    async releaseLease(owner) {
      await readModifyWrite<SyncLease>(db, META, 'sync', (cur) => (cur?.owner === owner ? { id: 'sync', owner: '', expiresAt: 0 } : null));
    },
    close() {
      db.close();
    },
  };
}
