import { useEffect, useState } from 'react';
import { guitarProfiles, type GuitarProfiles } from './api';

/** Unit guitar profiles; null while loading, 'unsupported' on an older daemon. */
export function useGuitars() {
  const [profiles, setProfiles] = useState<
    GuitarProfiles | null | 'unsupported'
  >(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    guitarProfiles(undefined, abort.signal)
      .then((current) => setProfiles(current ?? 'unsupported'))
      .catch((cause) => {
        if (!abort.signal.aborted) setError(String(cause));
      });
    return () => abort.abort();
  }, []);
  async function save(next: GuitarProfiles) {
    setBusy(true);
    setError('');
    try {
      const saved = await guitarProfiles(next);
      if (saved) setProfiles(saved);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return { profiles, error, busy, save };
}

/** Input trim the daemon will apply for the active guitar (mirrors guitars.rs). */
export function trimFor(profiles: GuitarProfiles) {
  const peak = (id: string | null | undefined) =>
    profiles.guitars.find((g) => g.id === id)?.peak_dbfs ?? null;
  const reference = peak(profiles.reference);
  const active = peak(profiles.active);
  if (reference == null || active == null) return 0;
  const trim = (reference - active) * (1 - profiles.character);
  return Math.min(24, Math.max(-24, Math.round(trim * 2) / 2));
}
