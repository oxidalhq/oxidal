import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  changeEffectPack,
  effectPacks,
  installedLv2,
  nativeDefaults,
  presetDetails,
  protectState,
  publishRig,
  rigAudioState,
  rigDocument,
  rigLibrary,
  rigNativeSources,
  tone3000Account,
  voiceCaptures,
  type Lv2Plugin,
} from '../../../api';
import type {
  NativeDefaultSettings,
  RecipeMetadata,
  RigNativeSource,
} from '../../../generated/contract';
import { allFactoryRecipes } from '../../../factoryCatalog';
import { factoryMetadata } from '../../../factoryMetadata';
import {
  buildFactoryRecipe,
  factoryRoles,
  type FactoryRole,
} from '../../../factoryRecipes';
import { factoryVoices, isFactoryVoice } from '../../../factoryVoices';
import { friendlyError } from '../../../lib/friendlyError';
import { playScenes } from '../../../presetChoices';
import { presetCopy } from '../newPreset';
import {
  builtName,
  installedKey,
  soundItems,
  type BuiltEntry,
  type SoundItem,
  type UnitFacts,
} from './oxidalSounds.model';

/**
 * Reads what this unit has and runs the actions of the Oxidal sounds browser:
 * build, play, install a pack and make a copy. Local assembly never stops audio
 * and never downloads a tone without being asked.
 * @see docs/factory-collection.md
 */

export type Progress = { label: string; steps: string[]; current: number };

type Packs = { id: string; name: string; installed: boolean }[];

export function useOxidalSounds({
  connected,
  onChanged,
  onOpenRig,
}: {
  connected: boolean;
  onChanged: () => void;
  onOpenRig?: () => void;
}) {
  const [plugins, setPlugins] = useState<Lv2Plugin[]>([]);
  const [sources, setSources] = useState<RigNativeSource[]>([]);
  const [downloaded, setDownloaded] = useState<Record<string, RigNativeSource>>(
    {},
  );
  const [bindings, setBindings] = useState<
    Partial<Record<FactoryRole, RigNativeSource>>
  >({});
  const [profile, setProfile] = useState('');
  const [defaults, setDefaults] = useState<NativeDefaultSettings | null>(null);
  const [built, setBuilt] = useState<BuiltEntry[]>([]);
  const [extra, setExtra] = useState<
    { entry: BuiltEntry; description: string; metadata: RecipeMetadata }[]
  >([]);
  const [packs, setPacks] = useState<Packs | null>(null);
  const [audioRunning, setAudioRunning] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [protectOn, setProtectOn] = useState(false);
  const [frames, setFrames] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [reads, setReads] = useState(0);
  const cancelled = useRef(false);
  const building = useRef<AbortController | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [ids] = useState(() =>
    Object.fromEntries(
      allFactoryRecipes.map((r) => [r.id, crypto.randomUUID()]),
    ),
  );

  const reload = useCallback(() => setReads((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [lv2, src, lib, defs, caps, pk, prot, acct, audio, details] =
        await Promise.allSettled([
          installedLv2(48000),
          rigNativeSources(),
          rigLibrary(),
          nativeDefaults(),
          voiceCaptures(),
          effectPacks(),
          protectState(),
          tone3000Account(),
          rigAudioState(),
          presetDetails(),
        ]);
      const entries: (BuiltEntry & { origin: string })[] = [];
      let nativeProfile = '';
      if (lib.status === 'fulfilled') {
        nativeProfile = lib.value.native_profile;
        let page = lib.value;
        for (let i = 0; i < 20; i++) {
          for (const preset of page.presets)
            entries.push({
              name: preset.name,
              revision: preset.revision,
              scenes: preset.scenes ?? [],
              origin: preset.origin,
            });
          if (!page.next) break;
          page = await rigLibrary(page.next);
        }
      }
      if (!alive) return;
      if (lv2.status === 'rejected' || lib.status === 'rejected') {
        const failure =
          lv2.status === 'rejected'
            ? lv2.reason
            : (lib as PromiseRejectedResult).reason;
        setLoadError(friendlyError(failure, 'read the collection'));
      } else setLoadError('');
      if (lv2.status === 'fulfilled') setPlugins(lv2.value);
      if (src.status === 'fulfilled') setSources(src.value);
      if (defs.status === 'fulfilled') setDefaults(defs.value.settings);
      if (caps.status === 'fulfilled')
        setDownloaded(
          Object.fromEntries(
            caps.value.map((c) => [`${c.tone_id}:${c.model_id}`, c.source]),
          ),
        );
      if (pk.status === 'fulfilled') {
        setPacks(pk.value.packs);
        setAudioRunning(pk.value.audio_running);
      }
      if (prot.status === 'fulfilled') setProtectOn(prot.value.on);
      setSignedIn(
        acct.status === 'fulfilled'
          ? acct.value.phase === 'connected' ||
              acct.value.phase === 'reconnecting'
          : null,
      );
      setFrames(
        audio.status === 'fulfilled'
          ? (audio.value.configured?.stream.input.period_frames ?? null)
          : null,
      );
      setProfile(nativeProfile);
      setBuilt(entries);
      const catalog = new Set(allFactoryRecipes.map(builtName));
      const found: typeof extra = [];
      if (details.status === 'fulfilled')
        for (const entry of entries) {
          if (entry.origin !== 'oxidal_example' || catalog.has(entry.name))
            continue;
          const d = details.value.entries.find(
            (e) => e.entry.kind === 'rig' && e.entry.id === entry.revision,
          )?.details;
          if (d?.metadata)
            found.push({
              entry,
              description: d.description,
              metadata: d.metadata,
            });
        }
      setExtra(found);
      setReady(lv2.status === 'fulfilled' && lib.status === 'fulfilled');
    })().catch((cause) => {
      if (alive) setLoadError(friendlyError(cause, 'read the collection'));
    });
    return () => {
      alive = false;
    };
  }, [reads]);

  const items = useMemo(
    () => soundItems(allFactoryRecipes, built, extra),
    [built, extra],
  );
  const facts: UnitFacts = useMemo(
    () => ({
      ready,
      plugins,
      captures: new Set(Object.keys(downloaded)),
      bindings,
      signedIn,
      protectOn,
      audioRunning,
      frames,
      installedPacks: packs
        ? new Set(packs.filter((p) => p.installed).map((p) => p.id))
        : null,
    }),
    [
      ready,
      plugins,
      downloaded,
      bindings,
      signedIn,
      protectOn,
      audioRunning,
      frames,
      packs,
    ],
  );
  const packName = (id: string) => packs?.find((p) => p.id === id)?.name ?? id;

  /** The saved source for a role: the player's choice, else a downloaded capture. */
  const sourceFor = useCallback(
    (role: FactoryRole) => {
      const chosen = bindings[role];
      if (chosen) return chosen;
      if (!isFactoryVoice(role)) return undefined;
      for (const c of factoryVoices[role].captures) {
        const key = installedKey(Object.keys(downloaded), c);
        if (key) return downloaded[key];
      }
      return undefined;
    },
    [bindings, downloaded],
  );

  async function build(
    item: SoundItem,
    then: string[] = [],
    chosen: Partial<Record<FactoryRole, RigNativeSource>> = {},
  ) {
    const recipe = item.recipe;
    if (!recipe) return undefined;
    setBusy(true);
    setError('');
    setNotice('');
    if (!then.length) {
      cancelled.current = false;
      setCancelling(false);
    }
    const steps = ['Building the preset', 'Saving its description', ...then];
    setProgress({ label: builtName(recipe), steps, current: 0 });
    const controller = new AbortController();
    building.current = controller;
    try {
      const document = await publishRig(
        buildFactoryRecipe(
          recipe,
          plugins,
          Object.fromEntries(
            factoryRoles(recipe).flatMap((role) => {
              const source = chosen[role] ?? sourceFor(role);
              return source ? [[role, source]] : [];
            }),
          ),
          profile,
          ids[recipe.id],
          defaults ?? undefined,
        ),
        controller.signal,
      );
      if (cancelled.current) {
        onChanged();
        reload();
        setError(
          `Stopped. ${builtName(recipe)} is saved in Library without its description.`,
        );
        setProgress(null);
        return undefined;
      }
      setProgress({ label: builtName(recipe), steps, current: 1 });
      const details = await presetDetails();
      await presetDetails({
        expected_revision: details.revision,
        entry_kind: 'rig',
        id: document.revision,
        description: recipe.description,
        categories: recipe.categories,
        metadata: factoryMetadata(recipe),
      });
      onChanged();
      reload();
      setNotice(`Built ${recipe.name}. It is in Library.`);
      return document.revision;
    } catch (cause) {
      if (controller.signal.aborted) {
        onChanged();
        reload();
        setError(
          `Stopped. If the device had already saved ${builtName(recipe)}, it is in Library.`,
        );
      } else setError(friendlyError(cause, `build ${recipe.name}`));
      setProgress(null);
    } finally {
      if (building.current === controller) building.current = null;
      setBusy(false);
      if (!then.length) setProgress(null);
    }
    return undefined;
  }

  async function play(item: SoundItem, known?: string) {
    if (busy) return;
    setError('');
    setNotice('');
    cancelled.current = false;
    setCancelling(false);
    try {
      const reused = known ?? item.built?.revision;
      const revision = reused ?? (await build(item, ['Starting audio']));
      if (!revision) return;
      if (cancelled.current) {
        setError('Stopped before starting audio.');
        return;
      }
      setBusy(true);
      setProgress({
        label: item.name,
        steps: ['Starting audio'],
        current: 0,
      });
      await playScenes(revision);
      onOpenRig?.();
    } catch (cause) {
      setError(friendlyError(cause, `play ${item.name}`));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /** Install every missing pack, one at a time, waiting for each job. */
  async function installPacks(ids: string[]) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      for (const id of ids) {
        setProgress({
          label: `Installing ${packName(id)}`,
          steps: ['Installing'],
          current: 0,
        });
        let state = await changeEffectPack(id, 'install');
        for (let i = 0; i < 600 && state.job; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          state = await effectPacks();
        }
      }
      setNotice('Installed. The effects are ready to use.');
    } catch (cause) {
      setError(friendlyError(cause, 'install the pack'));
    } finally {
      setProgress(null);
      setBusy(false);
      reload();
    }
  }

  /** A copy in Mine from the built example; the original stays unchanged. */
  async function makeCopy(item: SoundItem) {
    if (busy) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let revision = item.built?.revision;
      if (!revision) revision = await build(item);
      if (!revision) return false;
      const taken = new Set(built.map((b) => b.name));
      let name = `${item.name} copy`;
      for (let n = 2; taken.has(name); n++) name = `${item.name} copy ${n}`;
      await publishRig(presetCopy(await rigDocument(revision), name));
      onChanged();
      reload();
      setNotice(`${name} is in Mine. ${item.name} is unchanged.`);
      return true;
    } catch (cause) {
      setError(friendlyError(cause, `copy ${item.name}`));
      return false;
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function cancelBuild() {
    cancelled.current = true;
    setCancelling(true);
    building.current?.abort();
  }

  return {
    connected,
    items,
    facts,
    sources,
    profile,
    loadError,
    busy,
    progress,
    cancelling,
    notice,
    error,
    failures,
    setFailure: (key: string, message: string | null) =>
      setFailures((current) => {
        const next = { ...current };
        if (message) next[key] = message;
        else delete next[key];
        return next;
      }),
    setError,
    setNotice,
    packName,
    sourceFor,
    bind: (role: FactoryRole, source: RigNativeSource) =>
      setBindings((b) => ({ ...b, [role]: source })),
    reload,
    build,
    play,
    installPacks,
    makeCopy,
    cancelBuild,
    setProgress,
  };
}

export type OxidalSounds = ReturnType<typeof useOxidalSounds>;
