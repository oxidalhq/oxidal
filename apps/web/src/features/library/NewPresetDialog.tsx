import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@oxidal/design-system/components/select';
import { PresetStartOptions } from '@oxidal/design-system/patterns/preset-dialogs';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import {
  publishRig,
  type RigDocument,
  rigDocument,
  rigLibrary,
  rigNativeSources,
} from '../../api';
import { FailureNotice } from '../../FailureNotice';
import type {
  RigEntry,
  RigNativeSource,
  RigPublish,
} from '../../generated/contract';
import { useFailure } from '../../lib/useFailure';
import {
  emptyPreset,
  presetCopy,
  presetFromTone,
  presetNameError,
} from './newPreset';

type Start = 'empty' | 'copy' | 'oxidal' | 'tone3000';

/**
 * Creates an empty preset or starts from a saved preset, a prepared Oxidal
 * sound or a local TONE3000 tone. The new preset stays in Library until
 * the player chooses Play to edit.
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
      found.push(...page.presets);
      const seen = new Set<string>();
      while (alive && page.next) {
        if (seen.has(page.next))
          throw new Error('Preset list repeated a page.');
        seen.add(page.next);
        page = await rigLibrary(page.next);
        found.push(...page.presets);
      }
      if (!alive) return;
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
  const saved = rigs.map((r) => ({
    value: `rig:${r.revision}`,
    label: r.name,
  }));
  const examples = rigs
    .filter((r) => r.origin === 'oxidal_example')
    .map((r) => ({ value: `rig:${r.revision}`, label: r.name }));
  const localTones = tones.map((t) => ({
    value: `tone:${t.preset.sha256}`,
    label: t.preset.name,
  }));
  const sources = {
    empty: [],
    copy: saved,
    oxidal: examples,
    tone3000: localTones,
  };
  const options = sources[start];
  function chooseStart(choice: Start) {
    setStart(choice);
    setSource(sources[choice][0]?.value ?? '');
    setError('');
  }
  async function create() {
    setTouched(true);
    if (nameError || busy || !profile) return;
    if (start !== 'empty' && !source) {
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
        <PresetStartOptions<Start>
          value={start}
          onChange={chooseStart}
          options={[
            {
              id: 'empty',
              title: 'Empty',
              caption: 'Input straight to output. Add blocks in Rig.',
            },
            {
              id: 'copy',
              title: 'Copy of a saved preset',
              caption: saved.length
                ? 'Choose a saved revision to copy.'
                : 'No saved presets on this device.',
              disabled: !saved.length,
            },
            {
              id: 'oxidal',
              title: 'An Oxidal sound',
              caption: examples.length
                ? 'Choose a finished Oxidal preset.'
                : 'Prepare a sound in Library › Oxidal sounds first.',
              disabled: !examples.length,
            },
            {
              id: 'tone3000',
              title: 'A TONE3000 tone',
              caption: localTones.length
                ? 'Choose a TONE3000 chain saved on this device.'
                : 'Save a TONE3000 chain on this device first.',
              disabled: !localTones.length,
            },
          ]}
        />
        {start !== 'empty' && (
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
