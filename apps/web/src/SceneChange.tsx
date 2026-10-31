import { useEffect, useState } from 'react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { sceneBlends, type SceneBlends } from './api';
import { Slider } from './components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
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
  trails = false,
}: {
  /** The preset's stable id. */
  preset: string;
  disabled?: boolean;
  /** Input-gated branches keep their effect histories audible. */
  trails?: boolean;
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
        aria-label={`Scene change: ${blend ? `blend ${seconds(blend)}` : trails ? 'trails' : 'cut'}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {blend ? `Blend ${seconds(blend)}` : trails ? 'Trails' : 'Cut'}
      </button>
      {open && (
        <AdjustmentDialog title="Scene change" onCancel={() => setOpen(false)}>
          <div className="control-stack">
            <ToggleGroup
              type="single"
              value={blend ? 'blend' : 'trails'}
              disabled={busy}
              aria-label="Scene change"
              onValueChange={(value) => {
                if (value) {
                  setDraft(null);
                  void set(value === 'trails' ? 0 : saved || 2000);
                }
              }}
            >
              <ToggleGroupItem value="trails">
                {trails ? 'Trails' : 'Cut'}
              </ToggleGroupItem>
              <ToggleGroupItem value="blend">Blend</ToggleGroupItem>
            </ToggleGroup>
            <p className="caption">
              {blend
                ? trails
                  ? 'The outgoing guitar feed fades while the new scene starts. Its echoes and reverb continue ringing.'
                  : 'The outgoing scene, including its echoes and reverb, fades out while the new one starts.'
                : trails
                  ? 'The outgoing scene stops getting your guitar; its echoes and reverb ring out over the new scene.'
                  : 'This preset selects branch outputs, so outgoing echoes and reverb stop with the scene. Blend makes that change gradual.'}
            </p>
            {blend > 0 && (
              <div className="slider-field">
                <div className="slider-label">
                  <span>Blend time</span>
                  <output>{seconds(blend)}</output>
                </div>
                <Slider
                  min={0.5}
                  max={MAX_SECONDS}
                  step={0.5}
                  aria-label="Blend time"
                  disabled={busy}
                  value={[blend / 1000]}
                  onValueChange={([value]) => {
                    if (value != null) setDraft(Math.round(value * 1000));
                  }}
                  onValueCommit={([value]) => {
                    if (value != null) {
                      setDraft(null);
                      void set(Math.round(value * 1000));
                    }
                  }}
                  onBlur={commit}
                />
              </div>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
        </AdjustmentDialog>
      )}
    </>
  );
}
