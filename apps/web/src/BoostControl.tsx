import { useEffect, useState } from 'react';
import { Minus, Plus } from '@phosphor-icons/react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { boosts as boostApi, type BoostState } from './api';
import { Button } from './components/ui/button';
import './MasterLevel.css';

const RANGE = { min: -12, max: 12, step: 0.5 };
const db = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)} dB`;
const clamp = (n: number) =>
  Math.min(RANGE.max, Math.max(RANGE.min, Math.round(n * 2) / 2));

/**
 * Deliberate loudness for a solo preset or scene: a few dB on top of the
 * calibrated level. Stored on the unit, applied at the output while playing.
 * Hidden on a daemon without boosts.
 * @see docs/audio.md
 */
export function BoostControl({
  targets,
  disabled,
}: {
  /** The preset, then its sounding scene when it has scenes. */
  targets: { key: string; label: string }[];
  disabled?: boolean;
}) {
  const [state, setState] = useState<BoostState | null | 'unsupported'>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keys = targets.map((t) => t.key).join(' ');
  useEffect(() => {
    const abort = new AbortController();
    boostApi(undefined, abort.signal)
      .then((s) => setState(s ?? 'unsupported'))
      .catch(() => {});
    return () => abort.abort();
    // A different preset or scene may already carry a boost.
  }, [keys]);
  if (state === 'unsupported' || !targets.length) return null;
  const value = (key: string) => (state && state.boosts[key]) ?? 0;
  const total = targets.reduce((sum, t) => sum + value(t.key), 0);
  async function set(key: string, boost_db: number) {
    setBusy(true);
    setError('');
    try {
      const next = await boostApi({ key, boost_db: clamp(boost_db) });
      if (next) setState(next);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        className="boost-button"
        aria-label={`Boost ${db(total)}`}
        disabled={disabled || state == null}
        onClick={() => setOpen(true)}
      >
        Boost <span className="boost-value">{db(total)}</span>
      </Button>
      {open && (
        <AdjustmentDialog title="Boost" onCancel={() => setOpen(false)}>
          <div className="control-stack">
            <p className="caption">
              Extra level for a solo preset or scene, on top of the evened-out
              level. It stays on this unit and applies as soon as it plays.
            </p>
            {targets.map((t) => (
              <div key={t.key} className="boost-row">
                <span className="boost-label">{t.label}</span>
                <div className="guitar-trim">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`${t.label}: boost down 0.5 dB`}
                    disabled={busy || value(t.key) <= RANGE.min}
                    onClick={() => void set(t.key, value(t.key) - RANGE.step)}
                  >
                    <Minus aria-hidden="true" />
                  </Button>
                  <output aria-live="polite">{db(value(t.key))}</output>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`${t.label}: boost up 0.5 dB`}
                    disabled={busy || value(t.key) >= RANGE.max}
                    onClick={() => void set(t.key, value(t.key) + RANGE.step)}
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  disabled={busy || value(t.key) === 0}
                  onClick={() => void set(t.key, 0)}
                >
                  Reset
                </Button>
              </div>
            ))}
            {!!state?.calibrated_db && (
              <p className="caption">
                Evened out by {db(state.calibrated_db)} (Library → Even out
                all); the boost adds to that.
              </p>
            )}
            {targets.length > 1 && (
              <p role="status">Playing now: {db(total)} in all.</p>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
        </AdjustmentDialog>
      )}
    </>
  );
}
