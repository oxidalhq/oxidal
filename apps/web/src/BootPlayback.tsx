import { useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  Segment,
  SegmentedControl,
} from '@oxidal/design-system/components/segmented';
import { Caption } from '@oxidal/design-system/components/text';
import {
  SettingDisclosure,
  SettingGroup,
  SettingNotice,
  SettingRow,
} from '@oxidal/design-system/patterns/settings-page';

import {
  type AudioState,
  graphAudioCommand,
  type GraphAudioState,
  graphAudioState,
  libraryCatalog,
  playbackCommand,
  playbackState,
  rigAudioCommand,
  type RigAudioState,
  rigAudioState,
  setStartupFollow,
  type StartupState,
  startupState,
} from './api';
import { friendlyError } from './lib/friendlyError';

type Policy = 'off' | 'follow' | 'pinned';

/** The three startup choices (C2): label and what each one does. */
const POLICIES: [Policy, string, string][] = [
  ['off', 'Stay silent', 'Audio waits until you start it.'],
  [
    'follow',
    'Last session',
    'Plays the last preset you played, as it was saved. Each preset you start or switch to replaces it.',
  ],
  [
    'pinned',
    'A preset',
    'Plays the saved version pinned here. Save and play a preset first if it has edits.',
  ],
];

/** A single boot choice remains reachable regardless of the current audio owner. */
export function BootPlayback({
  native,
  mixed,
  effects,
  disabled,
  onNative,
  onMixed,
  onEffects,
}: {
  native: AudioState | null;
  mixed: RigAudioState | null;
  effects: GraphAudioState | null;
  disabled: boolean;
  onNative: (state: AudioState) => void;
  onMixed: (state: RigAudioState) => void;
  onEffects: (state: GraphAudioState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [startup, setStartup] = useState<StartupState | null>(null);
  const [namedTarget, setNamedTarget] = useState<{
    id: string;
    kind: string;
    name: string;
  } | null>(null);
  const targetName =
    namedTarget?.id === startup?.target?.id &&
    namedTarget?.kind === startup?.target?.kind
      ? namedTarget?.name
      : '';
  const selectedNow =
    native?.start_on_boot || mixed?.start_on_boot || effects?.start_on_boot;
  useEffect(() => {
    let alive = true;
    void startupState()
      .then((s) => alive && setStartup(s))
      .catch((cause) => {
        if (alive) setError(friendlyError(cause, 'read the startup choice'));
      });
    return () => {
      alive = false;
    };
  }, [
    selectedNow,
    mixed?.configured?.revision,
    native?.configured?.preset_id,
    effects?.configured?.library_id,
  ]);
  useEffect(() => {
    let alive = true;
    const target = startup?.target;
    if (target)
      void libraryCatalog()
        .then((catalog) => {
          const item = catalog.items.find(
            (item) => item.kind === target?.kind && item.id === target.id,
          );
          if (alive)
            setNamedTarget({ ...target, name: item?.name ?? 'Saved preset' });
        })
        .catch(() => {
          if (alive) setNamedTarget({ ...target, name: 'Saved preset' });
        });
    return () => {
      alive = false;
    };
  }, [startup?.target]);
  /** Off, Last played (follows each preset you play) or Pinned (exact version). */
  async function choose(policy: Policy) {
    if (busy) return;
    if (policy === 'off') {
      if (selectedNow) await toggle();
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!startup)
        throw new Error('Read the startup choice before changing it.');
      const owner =
        mixed?.phase === 'running'
          ? 'mixed'
          : native?.phase === 'running'
            ? 'native'
            : effects?.phase === 'running'
              ? 'effects'
              : null;
      const current =
        owner === 'mixed'
          ? mixed
          : owner === 'native'
            ? native
            : owner === 'effects'
              ? effects
              : null;
      if (policy === 'pinned' && !current)
        throw new Error('Play the saved version you want to pin first.');
      setStartup(
        await setStartupFollow(policy === 'follow', {
          expected: startup,
          capture:
            current && owner
              ? { owner, session: current.session, revision: current.revision }
              : null,
        }),
      );
    } catch (cause) {
      setError(friendlyError(cause, 'change what starts with Oxidal'));
      void startupState().then(setStartup, () => {});
    } finally {
      setBusy(false);
    }
  }
  const selected =
    native?.start_on_boot || mixed?.start_on_boot || effects?.start_on_boot;
  const invalid = !!native?.boot_error;
  const running =
    native?.phase === 'running' ||
    mixed?.phase === 'running' ||
    effects?.phase === 'running';
  async function toggle() {
    setBusy(true);
    setError('');
    try {
      if (effects?.start_on_boot) {
        onEffects(
          await graphAudioCommand(effects, {
            kind: 'set_boot',
            enabled: false,
          }),
        );
      } else if (mixed?.start_on_boot) {
        onMixed(
          await rigAudioCommand(mixed, { kind: 'set_boot', enabled: false }),
        );
      } else if (native && (native.start_on_boot || invalid)) {
        onNative(
          await playbackCommand(native, { kind: 'set_boot', enabled: false }),
        );
      } else if (effects?.phase === 'running') {
        onEffects(
          await graphAudioCommand(effects, { kind: 'set_boot', enabled: true }),
        );
      } else if (mixed?.phase === 'running') {
        onMixed(
          await rigAudioCommand(mixed, { kind: 'set_boot', enabled: true }),
        );
      } else if (native?.phase === 'running') {
        onNative(
          await playbackCommand(native, { kind: 'set_boot', enabled: true }),
        );
      }
    } catch (cause) {
      setError(friendlyError(cause, 'change automatic startup'));
    } finally {
      try {
        const [audio, rig, graph] = await Promise.all([
          playbackState(),
          rigAudioState(),
          graphAudioState(),
        ]);
        onNative(audio);
        onMixed(rig);
        onEffects(graph);
      } catch {
        /* Preserve confirmed state until the next successful status poll. */
      }
      setBusy(false);
    }
  }
  if (!selected && !invalid && !running) return null;
  const policy = invalid
    ? 'off'
    : (startup?.policy ?? (selected ? 'pinned' : 'off'));
  return (
    <section aria-label="When Oxidal starts" className="grid">
      <SettingGroup title="When Oxidal starts">
        {invalid ? (
          <SettingRow
            label="Startup setup"
            caption="The saved startup can no longer play. Clear it to choose again."
          >
            {/* A recovery action keeps a full touch target. */}
            <Button
              variant="outline"
              disabled={disabled || busy}
              onClick={() => void toggle()}
            >
              Clear invalid startup setup
            </Button>
          </SettingRow>
        ) : (
          <SettingRow
            stacked
            label="Start with"
            caption={POLICIES.find(([value]) => value === policy)?.[2]}
          >
            <SegmentedControl
              size="sm"
              className="w-full max-w-xl"
              aria-label="When Oxidal starts"
              value={policy}
              disabled={disabled || busy || !startup}
              onValueChange={(value) => void choose(value as Policy)}
            >
              {POLICIES.map(([value, label]) => (
                <Segment
                  key={value}
                  value={value}
                  disabled={
                    value === 'pinned'
                      ? !running
                      : value !== 'off' && !selected && !running
                  }
                >
                  {label}
                </Segment>
              ))}
            </SegmentedControl>
          </SettingRow>
        )}
        {startup?.target && (
          <SettingRow
            label="Startup preset"
            caption={
              <>
                {targetName || 'Reading name…'}
                <span className="block font-mono break-all">
                  Saved version {startup.target.id}
                </span>
              </>
            }
          >
            {policy === 'pinned' && running && (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || busy || !startup}
                onClick={() => void choose('pinned')}
              >
                Pin the playing saved version
              </Button>
            )}
          </SettingRow>
        )}
        {error && <SettingNotice tone="error">{error}</SettingNotice>}
        <SettingDisclosure label="Automatic startup">
          <Caption>
            Startup uses the confirmed sound and audio setup. With Last session,
            each preset you start or switch to replaces it; browsing does not.
            With A preset, the saved version pinned here plays, and later edits
            do not change it. Missing hardware or files leave audio stopped with
            a message; Oxidal never picks a different sound. Stop keeps this
            preference.
          </Caption>
          {native?.boot_error && <p role="alert">{native.boot_error}</p>}
        </SettingDisclosure>
      </SettingGroup>
    </section>
  );
}
