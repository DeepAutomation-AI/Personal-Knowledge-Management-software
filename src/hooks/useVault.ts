import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note, Vault } from '../lib/vault';
import { loadVault, saveVault } from '../lib/storage';

export function useVault() {
  const [vault, setVault] = useState<Vault | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const current = useRef<Vault | null>(null);
  const lastSaved = useRef<Vault | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    loadVault()
      .then((loaded) => {
        if (!cancelled) {
          current.current = loaded;
          lastSaved.current = loaded;
          setVault(loaded);
        }
      })
      .catch((error) => {
        if (!cancelled)
          setLoadError(error instanceof Error ? error.message : 'No se pudo abrir la bóveda.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const snapshot = current.current;
    if (!snapshot || snapshot === lastSaved.current) return queue.current;
    setSaving(true);
    const work = queue.current.catch(() => {}).then(() => saveVault(snapshot));
    queue.current = work;
    try {
      await work;
      lastSaved.current = snapshot;
      setSaveError('');
      if (current.current === snapshot) setSaving(false);
    } catch (error) {
      setSaving(false);
      setSaveError(error instanceof Error ? error.message : 'No se pudieron guardar los cambios.');
      throw error;
    }
  }, []);

  useEffect(() => {
    if (!vault || vault === lastSaved.current) return;
    setSaving(true);
    timer.current = setTimeout(() => {
      void flush().catch(() => {});
    }, 450);
    return () => clearTimeout(timer.current);
  }, [vault, flush]);

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (current.current !== lastSaved.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') void flush().catch(() => {});
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [flush]);

  const update = useCallback((operation: (notes: Note[]) => Note[]) => {
    const value = current.current;
    if (!value) return;
    const next: Vault = { version: 1, notes: operation(value.notes) };
    current.current = next;
    setVault(next);
  }, []);

  const replace = useCallback((value: Vault) => {
    current.current = value;
    setVault(value);
  }, []);
  return { vault, update, replace, loadError, saveError, saving, flush };
}
