import { useEffect, useState } from 'react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
import { presetArtwork, type AssetArtwork } from './api';
import { splitNative, type NativeDraft } from './rigDraft';

/** Select from immutable saved metadata, never the unsaved sounding session. */
export function NativeSplitDialog({
  effect,
  onSplit,
  onCancel,
}: {
  effect: NativeDraft;
  onSplit: (pair: [NativeDraft, NativeDraft]) => void;
  onCancel: () => void;
}) {
  const [blocks, setBlocks] = useState<AssetArtwork[]>([]);
  const [amp, setAmp] = useState('');
  const [cab, setCab] = useState('');
  const [input, setInput] = useState<'left' | 'right'>('left');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        if (effect.source.kind === 'bundle')
          throw new Error('Use an imported tone or a saved native copy.');
        const items = await presetArtwork(
          effect.preset.sha256,
          effect.source.kind === 'owned',
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setBlocks(items);
        const amps = items.filter((b) => b.gear === 'amp' && b.block_id);
        const cabs = items.filter((b) => b.gear === 'cab' && b.block_id);
        if (amps.length === 1) setAmp(amps[0]!.block_id);
        if (cabs.length === 1) setCab(cabs[0]!.block_id);
        if (!amps.length || !cabs.length)
          setError(
            'This tone needs separately classified amp and cab blocks. Keep it whole.',
          );
      } catch (cause) {
        if (!controller.signal.aborted) setError(String(cause));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [effect]);
  return (
    <AdjustmentDialog
      title="Separate amp & cab"
      onCancel={onCancel}
      className="stage-split-dialog"
    >
      <div className="space-y-3">
        <p className="text-sm break-words">{effect.name}</p>
        {loading && <p role="status">Reading saved tone…</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(['amp', 'cab'] as const).map((role) => (
            <label key={role} className="field min-w-0">
              {role === 'amp' ? 'Amp block' : 'Cab / IR block'}
              <select
                value={role === 'amp' ? amp : cab}
                disabled={loading}
                onChange={(e) =>
                  (role === 'amp' ? setAmp : setCab)(e.target.value)
                }
              >
                <option value="">Choose {role}</option>
                {blocks
                  .filter((b) => b.gear === role && b.block_id)
                  .map((b) => (
                    <option key={b.block_id} value={b.block_id}>
                      {b.title}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <label className="field min-w-0">
            Amp input
            <select
              value={input}
              onChange={(e) => setInput(e.target.value as 'left' | 'right')}
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 shrink-0 accent-primary"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          This NAM is an amp-head capture, without a baked-in cab.
        </label>
        <p className="caption">48 kHz · one amp + mono IR · checked on Play.</p>
        {error && (
          <p role="alert" className="text-sm break-words">
            {error}
          </p>
        )}
        <div className="action-row sticky bottom-0 bg-card py-2">
          <Button
            disabled={loading || !!error || !amp || !cab || !confirmed}
            onClick={() => onSplit(splitNative(effect, amp, cab, input))}
          >
            Separate
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Keep whole tone
          </Button>
        </div>
      </div>
    </AdjustmentDialog>
  );
}
