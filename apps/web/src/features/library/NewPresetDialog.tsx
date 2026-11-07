import { useEffect, useRef, useState } from 'react';
import {
  publishRig,
  rigDocument,
  rigLibrary,
  rigNativeSources,
  type RigDocument,
} from '../../api';
import type {
  RigEntry,
  RigNativeSource,
  RigPublish,
} from '../../generated/contract';
import { AdjustmentDialog } from '../../AdjustmentDialog';
import { FailureNotice } from '../../components/ui/failure';
import { useFailure } from '../../lib/useFailure';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  emptyPreset,
  presetCopy,
  presetFromTone,
  presetNameError,
} from './newPreset';

type Start = 'empty' | 'copy';

/**
 * The single New preset entry (7.3): a name, then Empty or Copy of a saved
 * preset. Works without audio hardware; nothing starts playing. The result
 * stays in Library until the player explicitly chooses Play to edit.
 * @see docs/presets/format.md
 */
export function NewPresetDialog({
  connected,
  onCreated,
  onCancel,
  onAdvanced,
}: {
  connected: boolean;
  onCreated: (created: RigDocument) => void;
  onCancel: () => void;
  /** Opens the effects-only or TONE3000 chain composer kept for parity. */
  onAdvanced: (composer: 'effects' | 'tone3000') => void;
}) {
  const [name, setName] = useState('');
  const [start, setStart] = useState<Start>('empty');
  const [source, setSource] = useState('');
  const [rigs, setRigs] = useState<RigEntry[]>([]);
  const [tones, setTones] = useState<RigNativeSource[]>([]);
  const [profile, setProfile] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { failure, fail, clear } = useFailure();
  const pending = useRef<{ key: string; request: RigPublish } | null>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const found: RigEntry[] = [];
      let page = await rigLibrary();
      const native = page.native_profile;
      for (let i = 0; i < 20; i++) {
        found.push(...page.presets);
        if (!page.next) break;
        page = await rigLibrary(page.next);
      }
      const sources = await rigNativeSources().catch(() => []);
      if (!alive) return;
      setRigs(found);
      setTones(sources);
      setProfile(native);
    })()
      .catch((e: unknown) => {
        if (alive) fail(e, 'read your presets');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [fail]);
  const nameError = presetNameError(name);
  const options = [
    ...rigs.map((r) => ({ value: `rig:${r.revision}`, label: r.name })),
    ...tones.map((t) => ({
      value: `tone:${t.preset.sha256}`,
      label: `${t.preset.name} · TONE3000`,
    })),
  ];
  async function create() {
    setTouched(true);
    if (nameError || busy || !profile) return;
    if (start === 'copy' && !source) {
      setError('Choose the preset to copy.');
      return;
    }
    setBusy(true);
    setError('');
    clear();
    // The same choices reuse the same request, so trying again after a lost
    // reply publishes the same revision instead of a second preset (7.24).
    const key = JSON.stringify([name.trim(), start, source, profile]);
    try {
      let request =
        pending.current?.key === key ? pending.current.request : null;
      if (request) {
        onCreated(await publishRig(request));
        pending.current = null;
        return;
      }
      if (start === 'empty') request = emptyPreset(name, profile);
      else if (source.startsWith('rig:'))
        request = presetCopy(await rigDocument(source.slice(4)), name);
      else {
        const tone = tones.find((t) => `tone:${t.preset.sha256}` === source);
        if (!tone) throw new Error('That TONE3000 preset is no longer here.');
        request = presetFromTone(name, tone, profile);
      }
      pending.current = { key, request };
      onCreated(await publishRig(request));
      pending.current = null;
    } catch (e) {
      fail(e, 'create the preset', () => void create());
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdjustmentDialog title="New preset" onCancel={() => !busy && onCancel()}>
      <form
        className="control-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input
            className="h-11 w-full rounded-md border border-input bg-card px-3"
            value={name}
            maxLength={120}
            autoFocus
            aria-invalid={touched && !!nameError}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {touched && nameError && <p role="alert">{nameError}</p>}
        <fieldset className="space-y-2">
          <legend className="mb-1 font-medium">Start from</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="start"
              checked={start === 'empty'}
              onChange={() => setStart('empty')}
            />
            Empty · input straight to output, add blocks in Rig
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="start"
              checked={start === 'copy'}
              onChange={() => setStart('copy')}
            />
            Copy of a saved preset
          </label>
        </fieldset>
        {start === 'copy' && (
          <label className="field">
            <span>Preset to copy</span>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger aria-label="Preset to copy">
                <SelectValue
                  placeholder={loading ? 'Reading presets…' : 'Choose…'}
                />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
        <p className="caption">
          Nothing starts playing. The original stays unchanged.
        </p>
        {error && <p role="alert">{error}</p>}
        <FailureNotice failure={failure} busy={busy} />
        <div className="action-row">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onAdvanced('effects')}
          >
            Effects chain composer
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onAdvanced('tone3000')}
          >
            TONE3000 chain editor
          </Button>
          <span className="flex-1" />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!connected || busy || loading || !profile}
          >
            {busy ? 'Creating…' : 'Create preset'}
          </Button>
        </div>
      </form>
    </AdjustmentDialog>
  );
}
