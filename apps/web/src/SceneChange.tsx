import { useEffect, useState } from 'react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { sceneBlends, type SceneBlends } from './api';
import { Button } from './components/ui/button';
import './MasterLevel.css';

const MAX_SECONDS = 10;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * How this preset changes scene. Trails: the outgoing scene stops getting
 * guitar, so its delay and reverb ring out. Blend: the whole outgoing scene
 * keeps sounding and fades out over a few seconds. Stored on the unit.
 * @see docs/audio.md
 */
export function SceneChange({
  preset,
  disabled,
}: {
  /** The preset's stable id. */
  preset: string;
  disabled?: boolean;
}) {
  const [blends, setBlends] = useState<SceneBlends | null | 'unsupported'>(
    null,
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The slider's position while dragging; saved when it is let go.
  const [draft, setDraft] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    sceneBlends(undefined, abort.signal)
      .then((b) => setBlends(b ?? 'unsupported'))
      .catch(() => {});
    return () => abort.abort();
  }, []);
  if (blends === 'unsupported' || blends == null) return null;
  const saved = blends.blends[preset] ?? 0;
  const blend = draft ?? saved;
  const commit = () => {
    if (draft != null && draft !== saved) void set(draft);
    setDraft(null);
  };
  async function set(blend_ms: number) {
    setBusy(true);
    setError('');
    try {
      const next = await sceneBlends({ preset, blend_ms });
      if (next) setBlends(next);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="scene-change"
        aria-label={`Scene change: ${blend ? `blend ${seconds(blend)}` : 'trails'}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {blend ? `Blend ${seconds(blend)}` : 'Trails'}
      </button>
      {open && (
        <AdjustmentDialog title="Scene change" onCancel={() => setOpen(false)}>
          <div className="control-stack">
            <div className="action-row" role="group" aria-label="Scene change">
              <Button
                variant="outline"
                aria-pressed={blend === 0}
                disabled={busy}
                onClick={() => void set(0)}
              >
                Trails
              </Button>
              <Button
                variant="outline"
                aria-pressed={blend > 0}
                disabled={busy}
                onClick={() => void set(saved || 2000)}
              >
                Blend
              </Button>
            </div>
            <p className="caption">
              {blend
                ? 'The whole outgoing scene keeps sounding and fades out while the new one starts.'
                : 'The outgoing scene stops getting your guitar at once; its delay and reverb ring out over the new scene.'}
            </p>
            {blend > 0 && (
              <label className="field">
                Blend time · {seconds(blend)}
                <input
                  type="range"
                  min={0.5}
                  max={MAX_SECONDS}
                  step={0.5}
                  aria-label="Blend time"
                  className="ink-range ink-range-wide"
                  style={
                    {
                      '--level': (blend / 1000 - 0.5) / (MAX_SECONDS - 0.5),
                    } as React.CSSProperties
                  }
                  value={blend / 1000}
                  onChange={(e) =>
                    setDraft(Math.round(Number(e.target.value) * 1000))
                  }
                  onPointerUp={commit}
                  onKeyUp={commit}
                  onBlur={commit}
                />
              </label>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
        </AdjustmentDialog>
      )}
    </>
  );
}
