import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNote, SEED_NOTES, type Vault } from './vault';
import { createSnapshot, listSnapshots, loadVault, restoreSnapshot, saveVault } from './storage';

function vault(title: string): Vault {
  return { version: 1, notes: [createNote(title, 'Pruebas', `# ${title}`)] };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('atlas-pkm');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('An open database blocked the test reset.'));
  });
}

async function putRaw(value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('atlas-pkm', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('vault', 'readwrite');
      transaction.objectStore('vault').put(value, 'primary');
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await deleteDatabase();
});

describe('local vault storage', () => {
  it('persists the initial seed once and returns independent values', async () => {
    const first = await loadVault();
    expect(first.notes).toEqual(SEED_NOTES);
    first.notes[0].title = 'Unsaved edit';
    const second = await loadVault();
    expect(second.notes).toEqual(SEED_NOTES);
    expect(second.notes[0]).not.toBe(SEED_NOTES[0]);
  });

  it('round-trips Markdown, folders, Unicode, flags and empty vaults', async () => {
    const saved = vault('Conocimiento 🧠');
    saved.notes[0].content = '# Una nota\n\n[[Otra nota]] y #aprendizaje';
    saved.notes[0].favorite = true;
    saved.notes[0].trashed = true;
    await saveVault(saved);
    expect(await loadVault()).toEqual(saved);
    await saveVault({ version: 1, notes: [] });
    expect(await loadVault()).toEqual({ version: 1, notes: [] });
  });

  it('never replaces a present but corrupt record with the demo vault', async () => {
    await loadVault();
    await putRaw(undefined);
    await expect(loadVault()).rejects.toThrow('La bóveda guardada no es válida');
    await putRaw({ version: 1, notes: [{ id: 'broken' }] });
    await expect(loadVault()).rejects.toThrow('no es válida');
  });

  it('rejects a storage quota failure and leaves the previous vault intact', async () => {
    const previous = vault('Guardada');
    await saveVault(previous);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('No space', 'QuotaExceededError');
    });
    await expect(saveVault(vault('Pendiente'))).rejects.toThrow('El almacenamiento está lleno');
    put.mockRestore();
    expect(await loadVault()).toEqual(previous);
  });

  it('rejects invalid vaults before changing stored data', async () => {
    const previous = vault('Original');
    await saveVault(previous);
    const invalid = { ...previous, notes: [previous.notes[0], previous.notes[0]] };
    await expect(saveVault(invalid)).rejects.toThrow('no es válida');
    expect(await loadVault()).toEqual(previous);
  });
});

describe('manual snapshots', () => {
  it('restores both the returned vault and the persisted vault', async () => {
    const original = vault('Antes');
    await saveVault(original);
    await createSnapshot(original);
    await saveVault(vault('Después'));
    const [snapshot] = await listSnapshots();
    expect(snapshot.noteCount).toBe(1);
    expect(snapshot).not.toHaveProperty('vault');
    expect(await restoreSnapshot(snapshot.id)).toEqual(original);
    expect(await loadVault()).toEqual(original);
  });

  it('retains the ten newest snapshots even when their clocks share a millisecond', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
    for (let index = 0; index < 12; index += 1) await createSnapshot(vault(`Snapshot ${index}`));
    const snapshots = await listSnapshots();
    expect(snapshots).toHaveLength(10);
    expect((await restoreSnapshot(snapshots[0].id)).notes[0].title).toBe('Snapshot 11');
    expect((await restoreSnapshot(snapshots[9].id)).notes[0].title).toBe('Snapshot 2');
    vi.useRealTimers();
  });

  it('reports a missing snapshot without replacing the current vault', async () => {
    const current = vault('Actual');
    await saveVault(current);
    await expect(restoreSnapshot('does-not-exist')).rejects.toThrow('ya no está disponible');
    expect(await loadVault()).toEqual(current);
  });

  it('restores the oldest of ten snapshots while atomically retaining a backup of the current vault', async () => {
    const original = vault('Snapshot 0');
    await createSnapshot(original);
    const [oldest] = await listSnapshots();
    for (let index = 1; index < 10; index += 1) await createSnapshot(vault(`Snapshot ${index}`));
    const current = vault('Current work');
    await saveVault(current);
    expect(await restoreSnapshot(oldest.id, current)).toEqual(original);
    expect(await loadVault()).toEqual(original);
    const snapshots = await listSnapshots();
    expect(snapshots).toHaveLength(10);
    expect(snapshots.some((snapshot) => snapshot.id === oldest.id)).toBe(false);
    expect(await restoreSnapshot(snapshots[0].id)).toEqual(current);
  });

  it('rolls back both the backup and the restore when persisting the restored vault fails', async () => {
    const original = vault('Backup original');
    await createSnapshot(original);
    const [snapshot] = await listSnapshots();
    const current = vault('Current work');
    await saveVault(current);
    const before = await listSnapshots();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('No space', 'QuotaExceededError');
    });
    await expect(restoreSnapshot(snapshot.id, current)).rejects.toThrow(
      'El almacenamiento está lleno',
    );
    put.mockRestore();
    expect(await listSnapshots()).toEqual(before);
    expect(await loadVault()).toEqual(current);
  });
});
