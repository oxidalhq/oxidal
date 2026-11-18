import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  effectPacks,
  installedLv2,
  type Lv2Plugin,
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
} from '../../../api';
import { allFactoryRecipes } from '../../../factoryCatalog';
import { factoryMetadata } from '../../../factoryMetadata';
import {
  buildFactoryRecipe,
  type FactoryRole,
  factoryRoles,
} from '../../../factoryRecipes';
import { factoryVoices, isFactoryVoice } from '../../../factoryVoices';
import type {
  NativeDefaultSettings,
  RecipeMetadata,
  RigNativeSource,
} from '../../../generated/contract';
import { friendlyError } from '../../../lib/friendlyError';
import { playScenes } from '../../../presetChoices';
import { presetCopy } from '../newPreset';
import { installPack, matchLevels } from './finish';
import {
  type BuiltEntry,
  builtName,
  cardState,
  installedKey,
  type SoundItem,
  soundItems,
  type UnitFacts,
} from './oxidalSounds.model';

/**
 * Reads what this unit has and runs the actions of the Oxidal sounds browser:
 * play, install a pack, get tones and make a copy. Every sound ships finished;
 * once its packs and tones are on the unit it is saved here without a further
 * step. Saving never stops audio and never downloads a tone without being asked.
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
  const [kept, setKept] = useState<Set<string>>(() => new Set());
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
  /** Sounds this page already tried to save, so a failure is not retried in a loop. */
  const tried = useRef(new Set<string>());
  const finishing = useRef(false);
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
      if (caps.status === 'fulfilled') {
        setDownloaded(
          Object.fromEntries(
            caps.value.captures.map((c) => [
              `${c.tone_id}:${c.model_id}`,
              c.source,
            ]),
          ),
        );
        setKept(
          new Set(
            (caps.value.downloaded ?? []).map(
              (d) => `${d.tone_id}:${d.model_id}`,
            ),
          ),
        );
      }
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
      kept,
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
      kept,
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
  const sourceIn = useCallback(
    (role: FactoryRole, captures: Record<string, RigNativeSource>) => {
      const chosen = bindings[role];
      if (chosen) return chosen;
      if (!isFactoryVoice(role)) return undefined;
      for (const c of factoryVoices[role].captures) {
        const key = installedKey(Object.keys(captures), c);
        if (key) return captures[key];
      }
      return undefined;
    },
    [bindings],
  );
  const sourceFor = useCallback(
    (role: FactoryRole) => sourceIn(role, downloaded),
    [sourceIn, downloaded],
  );

  async function build(
    item: SoundItem,
    then: string[] = [],
    chosen: Partial<Record<FactoryRole, RigNativeSource>> = {},
    fresh?: { plugins: Lv2Plugin[]; captures: Record<string, RigNativeSource> },
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
    const steps = ['Saving the preset', 'Saving its description', ...then];
    setProgress({ label: builtName(recipe), steps, current: 0 });
    const controller = new AbortController();
    building.current = controller;
    try {
      const document = await publishRig(
        buildFactoryRecipe(
          recipe,
          fresh?.plugins ?? plugins,
          Object.fromEntries(
            factoryRoles(recipe).flatMap((role) => {
              const source =
                chosen[role] ??
                (fresh ? sourceIn(role, fresh.captures) : sourceFor(role));
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
      tried.current.add(item.key);
      setNotice(`${recipe.name} is ready to play.`);
      return document.revision;
    } catch (cause) {
      if (controller.signal.aborted) {
        onChanged();
        reload();
        setError(
          `Stopped. If the device had already saved ${builtName(recipe)}, it is in Library.`,
        );
      } else setError(friendlyError(cause, `save ${recipe.name}`));
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
      // Play at once. Measuring the level takes over the audio for a while,
      // so a sound built here is left to Even out in Levels.
      setProgress({
        label: item.name,
        steps: ['Starting audio'],
        current: 0,
      });
      await playScenes(revision);
      if (!reused)
        setNotice(
          `${item.name} is playing. Its level is not matched yet: use Even out in Levels.`,
        );
      onOpenRig?.();
    } catch (cause) {
      setError(friendlyError(cause, `play ${item.name}`));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /**
   * Save every sound an install has just completed. Reads the unit again
   * first, so it sees the packs and tones that were added.
   */
  async function finishReady(): Promise<number> {
    if (finishing.current || !profile) return 0;
    finishing.current = true;
    try {
      const [lv2, caps] = await Promise.all([
        installedLv2(48000),
        voiceCaptures().catch(() => null),
      ]);
      const captures = caps
        ? Object.fromEntries(
            caps.captures.map((c) => [`${c.tone_id}:${c.model_id}`, c.source]),
          )
        : downloaded;
      const now: UnitFacts = {
        ...facts,
        ready: true,
        plugins: lv2,
        captures: new Set(Object.keys(captures)),
      };
      // Only what this install completed: sounds that were ready before are
      // saved when they are first played.
      const pending = items.filter(
        (item) =>
          item.recipe &&
          !item.built &&
          !tried.current.has(item.key) &&
          cardState(item, facts).kind !== 'build' &&
          cardState(item, now).kind === 'build',
      );
      let saved = 0;
      cancelled.current = false;
      setCancelling(false);
      for (const item of pending) {
        if (cancelled.current) break;
        tried.current.add(item.key);
        if (await build(item, [], {}, { plugins: lv2, captures })) saved++;
      }
      if (saved) {
        setBusy(true);
        setProgress({
          label: saved > 1 ? `${saved} sounds` : 'Matching level',
          steps: ['Matching levels'],
          current: 0,
        });
        const unmatched = await matchLevels();
        setBusy(false);
        setProgress(null);
        if (unmatched) setNotice(unmatched);
        else if (saved > 1) setNotice(`${saved} sounds are ready to play.`);
      }
      return saved;
    } finally {
      finishing.current = false;
    }
  }

  /** Install every missing pack, one at a time, then save the sounds that are
   * now complete. A pack that did not install says why. */
  async function installPacks(ids: string[]) {
    setBusy(true);
    setError('');
    setNotice('');
    let installed = false;
    try {
      for (const id of ids) {
        setProgress({
          label: `Installing ${packName(id)}`,
          steps: ['Installing'],
          current: 0,
        });
        await installPack(id);
      }
      installed = true;
      setNotice('Installed. The effects are ready to use.');
    } catch (cause) {
      setError(friendlyError(cause, 'install the pack'));
    } finally {
      setProgress(null);
      setBusy(false);
      reload();
    }
    if (installed) await finishReady();
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
    finishReady,
    play,
    installPacks,
    makeCopy,
    cancelBuild,
    setProgress,
  };
}

export type OxidalSounds = ReturnType<typeof useOxidalSounds>;
