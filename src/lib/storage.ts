import { assertValidVault, SEED_NOTES, type Vault } from './vault';

const DATABASE_NAME = 'atlas-pkm';
const DATABASE_VERSION = 1;
const VAULT_STORE = 'vault';
const SNAPSHOT_STORE = 'snapshots';
const VAULT_KEY = 'primary';
const SNAPSHOT_LIMIT = 10;

export interface SnapshotInfo {
  id: string;
  createdAt: string;
  noteCount: number;
}

interface StoredSnapshot extends SnapshotInfo {
  vault: Vault;
}

export class StorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageError';
  }
}

function storageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const name = error instanceof Error ? error.name : '';
  const message =
    name === 'QuotaExceededError'
      ? 'El almacenamiento está lleno. Exporta una copia de tu bóveda y libera espacio.'
      : name === 'SecurityError'
        ? 'El navegador no permite guardar datos en este contexto.'
        : 'No se pudo acceder al almacenamiento local. Tus cambios no se han guardado.';
  return new StorageError(message, { cause: error });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageError('Este navegador no ofrece almacenamiento IndexedDB.'));
      return;
    }
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(storageError(error));
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(VAULT_STORE)) database.createObjectStore(VAULT_STORE);
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        database.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
      }
    };
    request.onerror = () => {
      settled = true;
      reject(storageError(request.error));
    };
    request.onblocked = () => {
      settled = true;
      reject(
        new StorageError(
          'Otra pestaña está bloqueando el almacenamiento. Ciérrala e inténtalo de nuevo.',
        ),
      );
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

interface TransactionContext<T> {
  transaction: IDBTransaction;
  result: (value: T) => void;
  fail: (error: unknown) => void;
}

async function runTransaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (context: TransactionContext<T>) => void,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    let result: T;
    let failure: unknown;
    try {
      transaction = database.transaction(stores, mode);
    } catch (error) {
      database.close();
      reject(storageError(error));
      return;
    }
    const fail = (error: unknown) => {
      failure = error;
      try {
        transaction.abort();
      } catch {
        database.close();
        reject(storageError(error));
      }
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onabort = () => {
      database.close();
      reject(storageError(failure ?? transaction.error));
    };
    try {
      work({
        transaction,
        result: (value) => {
          result = value;
        },
        fail,
      });
    } catch (error) {
      fail(error);
    }
  });
}

function assertVault(value: unknown): asserts value is Vault {
  try {
    assertValidVault(value);
  } catch (error) {
    throw new StorageError('La bóveda guardada no es válida. No se reemplazaron tus datos.', {
      cause: error,
    });
  }
}

export function loadVault(): Promise<Vault> {
  return runTransaction([VAULT_STORE], 'readwrite', ({ transaction, result, fail }) => {
    const store = transaction.objectStore(VAULT_STORE);
    const key = store.getKey(VAULT_KEY);
    key.onsuccess = () => {
      try {
        if (key.result === undefined) {
          const vault: Vault = { version: 1, notes: structuredClone(SEED_NOTES) };
          store.put(vault, VAULT_KEY);
          result(vault);
          return;
        }
        const request = store.get(VAULT_KEY);
        request.onsuccess = () => {
          try {
            assertVault(request.result);
            result(request.result);
          } catch (error) {
            fail(error);
          }
        };
      } catch (error) {
        fail(error);
      }
    };
  });
}

export function saveVault(vault: Vault): Promise<void> {
  try {
    assertVault(vault);
  } catch (error) {
    return Promise.reject(error);
  }
  return runTransaction([VAULT_STORE], 'readwrite', ({ transaction }) => {
    transaction.objectStore(VAULT_STORE).put(vault, VAULT_KEY);
  });
}

function newestFirst(a: SnapshotInfo, b: SnapshotInfo): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

export function createSnapshot(vault: Vault): Promise<void> {
  try {
    assertVault(vault);
  } catch (error) {
    return Promise.reject(error);
  }
  return runTransaction([SNAPSHOT_STORE], 'readwrite', ({ transaction, fail }) => {
    writeSnapshot(transaction.objectStore(SNAPSHOT_STORE), vault, fail);
  });
}

function writeSnapshot(
  store: IDBObjectStore,
  vault: Vault,
  fail: (error: unknown) => void,
  afterWrite?: () => void,
): void {
  const request = store.getAll();
  request.onsuccess = () => {
    try {
      const existing = request.result as StoredSnapshot[];
      const latestTime = existing.reduce(
        (latest, item) => Math.max(latest, Date.parse(item.createdAt)),
        0,
      );
      const snapshot: StoredSnapshot = {
        id: crypto.randomUUID(),
        createdAt: new Date(Math.max(Date.now(), latestTime + 1)).toISOString(),
        noteCount: vault.notes.length,
        vault,
      };
      store.add(snapshot);
      const snapshots = [...existing, snapshot].sort(newestFirst);
      for (const oldSnapshot of snapshots.slice(SNAPSHOT_LIMIT)) store.delete(oldSnapshot.id);
      afterWrite?.();
    } catch (error) {
      fail(error);
    }
  };
}

export function listSnapshots(): Promise<SnapshotInfo[]> {
  return runTransaction([SNAPSHOT_STORE], 'readonly', ({ transaction, result }) => {
    const request = transaction.objectStore(SNAPSHOT_STORE).getAll();
    request.onsuccess = () =>
      result(
        (request.result as StoredSnapshot[])
          .sort(newestFirst)
          .map(({ id, createdAt, noteCount }) => ({ id, createdAt, noteCount })),
      );
  });
}

/** Read the target before pruning, optionally back up the current vault, then restore atomically. */
export function restoreSnapshot(id: string, currentVault?: Vault): Promise<Vault> {
  try {
    if (currentVault) assertVault(currentVault);
  } catch (error) {
    return Promise.reject(error);
  }
  return runTransaction(
    [VAULT_STORE, SNAPSHOT_STORE],
    'readwrite',
    ({ transaction, result, fail }) => {
      const snapshots = transaction.objectStore(SNAPSHOT_STORE);
      const request = snapshots.get(id);
      request.onsuccess = () => {
        try {
          if (!request.result)
            throw new StorageError('Esta copia de seguridad ya no está disponible.');
          const snapshot = request.result as StoredSnapshot;
          assertVault(snapshot.vault);
          const persistRestored = () => {
            transaction.objectStore(VAULT_STORE).put(snapshot.vault, VAULT_KEY);
            result(snapshot.vault);
          };
          if (currentVault) writeSnapshot(snapshots, currentVault, fail, persistRestored);
          else persistRestored();
        } catch (error) {
          fail(error);
        }
      };
    },
  );
}
