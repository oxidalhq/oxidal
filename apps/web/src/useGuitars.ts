import { friendlyError } from './lib/friendlyError';
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
        if (!abort.signal.aborted)
          setError(friendlyError(cause, 'read your guitars'));
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
      setError(friendlyError(cause, 'read your guitars'));
    } finally {
      setBusy(false);
    }
  }
  return { profiles, error, busy, save };
}

/** Trim the daemon applies for the active guitar (mirrors guitars.rs). */
export function trimFor(profiles: GuitarProfiles) {
  return profiles.guitars.find((g) => g.id === profiles.active)?.trim_db ?? 0;
}

/** Gate threshold the daemon will apply for the active guitar (mirrors guitars.rs). */
export function gateFor(profiles: GuitarProfiles) {
  const guitar = profiles.guitars.find((g) => g.id === profiles.active);
  if (!guitar?.gate || guitar.noise_dbfs == null) return null;
  const gate = Math.round(guitar.noise_dbfs + (guitar.trim_db ?? 0) + 6);
  return Math.min(-20, Math.max(-96, gate));
}
