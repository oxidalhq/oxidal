import { useEffect, useRef, useState } from 'react';
import { AdjustmentDialog } from '../../../AdjustmentDialog';
import { downloadVoice, tone3000Models, tone3000Tone } from '../../../api';
import type { RigNativeSource } from '../../../generated/contract';
import { Button } from '../../../components/ui/button';
import { DialogFooter } from '../../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { factoryRoles, type FactoryRole } from '../../../factoryRecipes';
import { factoryVoices, isFactoryVoice } from '../../../factoryVoices';
import {
  DeviceError,
  errorDetails,
  friendlyError,
} from '../../../lib/friendlyError';
import { ToneLink } from './ToneLink';
import {
  missingTones,
  roleLabel,
  type MissingTone,
  type SoundItem,
} from './oxidalSounds.model';
import type { OxidalSounds } from './useOxidalSounds';
import './oxidal.css';

type Capture = { tone: number; model?: number };
type Info =
  | {
      state: 'ok';
      title: string;
      creator: string;
      url: string;
      size: string;
      model: number;
      modelName: string;
    }
  | { state: 'removed' }
  | { state: 'error'; message: string; detail: string };

/** What went wrong in the device's or browser's own words, with the HTTP
 * status and error kind when the device sent them. */
function technical(cause: unknown): string {
  const text = errorDetails(cause);
  return cause instanceof DeviceError
    ? `HTTP ${cause.status} · ${cause.code} · ${text}`
    : text;
}

const removedError = (cause: unknown) =>
  cause instanceof DeviceError &&
  (cause.code === 'not_found' || cause.status === 404);

/** One tone as TONE3000 presents it to the signed-in account: title, creator,
 * file size and the model to download; or that it was removed. A voice that
 * names no model gets the tone's first model. Read-only: nothing downloads. */
async function describeTone(
  capture: Capture,
  signal: AbortSignal,
  format: 'nam' | 'ir' = 'nam',
): Promise<Info> {
  try {
    const tone = await tone3000Tone(capture.tone, signal);
    let found: { id: number; name: string; size?: string | null } | undefined;
    for (let page = 1; page <= 5 && !found; page++) {
      const models = await tone3000Models(capture.tone, page, signal, format);
      found =
        capture.model === undefined
          ? models.data[0]
          : models.data.find((m) => m.id === capture.model);
      if (!models.total_pages || page >= models.total_pages) break;
    }
    if (!found) return { state: 'removed' };
    return {
      state: 'ok',
      title: tone.title,
      creator: tone.user.display_name || tone.user.username,
      url: tone.url,
      size: found.size ?? '',
      model: found.id,
      modelName: found.name,
    };
  } catch (cause) {
    if (removedError(cause)) return { state: 'removed' };
    return {
      state: 'error',
      message: friendlyError(cause, 'read TONE3000'),
      detail: technical(cause),
    };
  }
}

const formatOf = (role: FactoryRole): 'nam' | 'ir' =>
  isFactoryVoice(role) && factoryVoices[role].kind === 'ir' ? 'ir' : 'nam';

type Phase =
  | { name: 'pick' }
  | { name: 'build' }
  | { name: 'done'; revision: string }
  | { name: 'fail'; message: string }
  | { name: 'alt'; role: FactoryRole };

/** Where one tone's download stands in this dialog. */
type Row =
  | { state: 'working' }
  | { state: 'done' }
  | { state: 'failed'; message: string; detail: string; removed: boolean };

/**
 * Get tones: every tone a sound still needs, one row each, with what it is
 * for, a link to its TONE3000 page, its model and size. Each tone downloads on
 * its own, so one that fails never blocks the others; Download all runs the
 * rest in turn. A tone already downloaded in Tones and IRs is added without
 * asking TONE3000. Once every tone is here the sound is saved, then Play.
 * @see docs/factory-collection.md
 */
export function GetTonesDialog({
  item,
  unit,
  onClose,
}: {
  item: SoundItem;
  unit: OxidalSounds;
  onClose: () => void;
}) {
  const [initial] = useState<MissingTone[]>(() =>
    missingTones(item, unit.facts),
  );
  const [overrides, setOverrides] = useState<
    Partial<Record<FactoryRole, Capture>>
  >({});
  const [infos, setInfos] = useState<Record<string, Info>>({});
  const [rows, setRows] = useState<Partial<Record<FactoryRole, Row>>>({});
  const [phase, setPhase] = useState<Phase>({ name: 'pick' });
  const [attempt, setAttempt] = useState(0);
  const chosen = useRef<Partial<Record<FactoryRole, RigNativeSource>>>({});
  const closed = useRef(false);
  const total = new Set(item.recipe ? factoryRoles(item.recipe) : []).size;
  const captureOf = (tone: MissingTone): Capture | null =>
    tone.named
      ? (overrides[tone.role] ?? { tone: tone.tone, model: tone.model })
      : null;
  const keyOf = (c: Capture) => `${c.tone}:${c.model ?? ''}`;
  /** The model already on this unit for a tone, unless another was chosen. */
  const keptOf = (tone: MissingTone) =>
    tone.named && !overrides[tone.role] ? tone.kept : undefined;

  const describedKeys = initial
    .map(captureOf)
    .concat(
      phase.name === 'alt' && isFactoryVoice(phase.role)
        ? factoryVoices[phase.role].captures.slice(1)
        : [],
    )
    .flatMap((c) => (c ? [c] : []));
  const formats = new Map(
    initial.flatMap((t) => {
      const c = captureOf(t);
      return c ? [[keyOf(c), formatOf(t.role)] as const] : [];
    }),
  );
  const wanted = JSON.stringify(
    describedKeys.map((c) => [keyOf(c), formats.get(keyOf(c)) ?? 'nam']),
  );
  // One tone at a time: the unit passes TONE3000 requests on in turn.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      for (const [capture, format] of JSON.parse(wanted) as [
        string,
        'nam' | 'ir',
      ][]) {
        if (controller.signal.aborted) return;
        const [tone, model] = capture.split(':');
        const info = await describeTone(
          { tone: Number(tone), model: model ? Number(model) : undefined },
          controller.signal,
          format,
        );
        if (!controller.signal.aborted)
          setInfos((current) => ({ ...current, [capture]: info }));
      }
    })();
    return () => controller.abort();
  }, [wanted, attempt]);
  useEffect(() => {
    // Set again on mount: StrictMode runs this cleanup once before the real
    // mount, which would otherwise leave every download ignored.
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);

  const named = initial.filter(
    (t): t is Extract<MissingTone, { named: true }> => t.named,
  );
  const unbound = initial.filter(
    (t) => !t.named && !unit.facts.bindings[t.role],
  );
  const working = named.some((t) => rows[t.role]?.state === 'working');
  const left = named.filter((t) => rows[t.role]?.state !== 'done');
  /** The model to fetch: the one already here, the sound's own, or the one
   * TONE3000 offers for the tone. Undefined until it is known. */
  function modelOf(tone: MissingTone): number | undefined {
    const capture = captureOf(tone);
    if (!capture) return undefined;
    const info = infos[keyOf(capture)];
    return (
      keptOf(tone) ??
      capture.model ??
      (info?.state === 'ok' ? info.model : undefined)
    );
  }
  function titleOf(tone: MissingTone) {
    const capture = captureOf(tone);
    const info = capture ? infos[keyOf(capture)] : undefined;
    return info?.state === 'ok' ? info.title : roleLabel(tone.role);
  }
  const removedOf = (tone: MissingTone) => {
    const capture = captureOf(tone);
    return (
      keptOf(tone) === undefined &&
      !!capture &&
      infos[keyOf(capture)]?.state === 'removed'
    );
  };

  /** Fetch one tone and turn it into a capture. Resolves to whether it worked. */
  async function addOne(tone: MissingTone): Promise<boolean> {
    const capture = captureOf(tone);
    const model = modelOf(tone);
    if (!capture || model === undefined) return false;
    unit.setFailure(item.key, null);
    setRows((r) => ({ ...r, [tone.role]: { state: 'working' } }));
    try {
      const ready = await downloadVoice(
        capture.tone,
        model,
        titleOf(tone).slice(0, 120),
      );
      chosen.current[tone.role] = ready.capture.source;
      unit.bind(tone.role, ready.capture.source);
      setRows((r) => ({ ...r, [tone.role]: { state: 'done' } }));
      return true;
    } catch (cause) {
      const removed =
        keptOf(tone) === undefined &&
        (await describeTone(capture, new AbortController().signal)).state ===
          'removed';
      setRows((r) => ({
        ...r,
        [tone.role]: {
          state: 'failed',
          removed,
          message: removed
            ? `"${titleOf(tone)}" was removed from TONE3000.`
            : friendlyError(cause, `download ${titleOf(tone)}`),
          detail: technical(cause),
        },
      }));
      return false;
    }
  }

  /** Save the sound once every tone it needs is on this unit. */
  async function finish() {
    if (closed.current) return;
    setPhase({ name: 'build' });
    try {
      const revision = await unit.build(item, [], chosen.current);
      if (revision) {
        setPhase({ name: 'done', revision });
        // Other sounds that share these tones are complete now as well.
        void unit.finishReady();
      } else onClose();
    } catch (cause) {
      setPhase({
        name: 'fail',
        message: friendlyError(cause, `save ${item.name}`),
      });
    }
  }

  async function addAndMaybeFinish(tones: MissingTone[]) {
    let ok = true;
    for (const tone of tones) {
      if (closed.current) return;
      ok = (await addOne(tone)) && ok;
    }
    const remaining = named.filter(
      (t) =>
        !tones.includes(t) &&
        rows[t.role]?.state !== 'done' &&
        !chosen.current[t.role],
    );
    if (ok && !remaining.length && !unbound.length) await finish();
  }

  const readable = (tone: MissingTone) => modelOf(tone) !== undefined;
  const allReady =
    left.length > 0 &&
    left.every((t) => readable(t) && !removedOf(t)) &&
    !unbound.length;
  const failedReads = named.flatMap((t) => {
    const c = captureOf(t);
    const info = c ? infos[keyOf(c)] : undefined;
    return info?.state === 'error' && keptOf(t) === undefined
      ? [{ role: t.role, ...info }]
      : [];
  });

  const title = `Get tones for ${item.name}`;
  return (
    <AdjustmentDialog
      title={title}
      onCancel={() => {
        if (!working && phase.name !== 'build') onClose();
      }}
    >
      <div className="control-stack oxidal-tones">
        {phase.name === 'pick' && (
          <>
            <p>
              Each tone downloads from your TONE3000 account to this unit, one
              at a time. A tone already downloaded in Tones and IRs is added
              without downloading it again.
            </p>
            <ul className="oxidal-tone-list">
              {initial.map((tone) => {
                const capture = captureOf(tone);
                const info = capture ? infos[keyOf(capture)] : undefined;
                const row = rows[tone.role];
                const kept = keptOf(tone);
                const removed = removedOf(tone);
                return (
                  <li
                    key={tone.role}
                    className="oxidal-tone-row"
                    data-state={row?.state ?? (kept ? 'kept' : 'needed')}
                  >
                    {capture ? (
                      <>
                        <div className="oxidal-tone-what">
                          <span className="caption">
                            For: {roleLabel(tone.role)}
                          </span>
                          <span>
                            <ToneLink
                              tone={capture.tone}
                              url={info?.state === 'ok' ? info.url : undefined}
                            >
                              {info?.state === 'ok'
                                ? info.title
                                : `TONE3000 tone ${capture.tone}`}
                            </ToneLink>
                            {info?.state === 'ok' && ` · by ${info.creator}`}
                          </span>
                          <span className="caption">
                            {info?.state === 'ok'
                              ? `Model: ${info.modelName} (${info.model})${info.size ? ` · ${info.size}` : ''}`
                              : kept !== undefined
                                ? `Model ${kept}`
                                : capture.model !== undefined
                                  ? `Model ${capture.model}`
                                  : 'First model of the tone'}
                          </span>
                          <span
                            className="caption oxidal-tone-status"
                            role={
                              row?.state === 'failed' ||
                              (info?.state === 'error' && kept === undefined)
                                ? 'alert'
                                : undefined
                            }
                          >
                            {row?.state === 'done'
                              ? '✓ On this unit'
                              : row?.state === 'working'
                                ? kept !== undefined
                                  ? 'Adding…'
                                  : 'Downloading…'
                                : row?.state === 'failed'
                                  ? row.message
                                  : kept !== undefined
                                    ? 'Already downloaded in Tones and IRs'
                                    : removed
                                      ? 'Removed from TONE3000'
                                      : info?.state === 'error'
                                        ? info.message
                                        : !info && modelOf(tone) === undefined
                                          ? 'Reading TONE3000…'
                                          : ''}
                          </span>
                          {row?.state === 'failed' && (
                            <details>
                              <summary className="caption">Details</summary>
                              <code className="caption">{row.detail}</code>
                            </details>
                          )}
                          {row?.state !== 'failed' &&
                            info?.state === 'error' &&
                            kept === undefined && (
                              <details>
                                <summary className="caption">Details</summary>
                                <code className="caption">{info.detail}</code>
                              </details>
                            )}
                        </div>
                        {row?.state !== 'done' &&
                          (removed ||
                          (row?.state === 'failed' && row.removed) ? (
                            <Button
                              variant="outline"
                              onClick={() =>
                                setPhase({ name: 'alt', role: tone.role })
                              }
                            >
                              Choose another tone…
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              aria-label={`${kept !== undefined ? 'Add' : 'Download'}: ${roleLabel(tone.role)}`}
                              disabled={
                                unit.busy ||
                                working ||
                                modelOf(tone) === undefined
                              }
                              onClick={() => void addAndMaybeFinish([tone])}
                            >
                              {row?.state === 'failed'
                                ? 'Try again'
                                : kept !== undefined
                                  ? 'Add'
                                  : 'Download'}
                            </Button>
                          ))}
                      </>
                    ) : (
                      <label className="field">
                        <span>
                          {roleLabel(tone.role)}: one of your saved tones
                        </span>
                        <Select
                          value={unit.facts.bindings[tone.role]?.preset.sha256}
                          onValueChange={(value) => {
                            const source = unit.sources.find(
                              (s) => s.preset.sha256 === value,
                            );
                            if (source) unit.bind(tone.role, source);
                          }}
                        >
                          <SelectTrigger aria-label={`${tone.role} tone`}>
                            <SelectValue placeholder="Choose a saved tone…" />
                          </SelectTrigger>
                          <SelectContent>
                            {unit.sources.map((s) => (
                              <SelectItem
                                key={s.preset.sha256}
                                value={s.preset.sha256}
                              >
                                {s.preset.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="caption">
              On this unit: {total - left.length - unbound.length} of {total}
            </p>
            {unit.sources.length === 0 && unbound.length > 0 && (
              <p className="caption">
                No saved tones yet. Download or import one in Tones and IRs
                first.
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={working} onClick={onClose}>
                {named.some((t) => rows[t.role]?.state === 'done')
                  ? 'Close'
                  : 'Cancel'}
              </Button>
              {failedReads.length > 0 && (
                <Button
                  variant="outline"
                  disabled={working}
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  Read again
                </Button>
              )}
              {left.length > 0 ? (
                <Button
                  disabled={unit.busy || working || !allReady}
                  onClick={() => void addAndMaybeFinish(left)}
                >
                  {left.length === 1 ? 'Download' : 'Download all'}
                </Button>
              ) : (
                <Button
                  disabled={unit.busy || working || unbound.length > 0}
                  onClick={() => void finish()}
                >
                  Save the sound
                </Button>
              )}
            </DialogFooter>
          </>
        )}
        {phase.name === 'build' && (
          <>
            <p role="status">
              {unit.progress
                ? `${unit.progress.label} · Step ${unit.progress.current + 1} of ${unit.progress.steps.length} · ${unit.progress.steps[unit.progress.current]}`
                : 'Saving the preset …'}
            </p>
            <progress aria-label="Progress" />
          </>
        )}
        {phase.name === 'done' && (
          <>
            <p role="status">
              <strong>Ready.</strong> All tones are on this unit and the preset
              is ready.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button
                onClick={() => {
                  void unit.play(item, phase.revision);
                  onClose();
                }}
              >
                Play
              </Button>
            </DialogFooter>
          </>
        )}
        {phase.name === 'fail' && (
          <>
            <p role="alert">
              <strong>Failed:</strong> {phase.message}
            </p>
            <p className="caption">
              The tones stay on this unit; only saving the sound failed.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => void finish()}>Try again</Button>
            </DialogFooter>
          </>
        )}
        {phase.name === 'alt' && (
          <>
            <p className="caption">
              From your TONE3000 account and this unit. Pick one with a similar
              sound.
            </p>
            <ul className="oxidal-tone-list">
              {isFactoryVoice(phase.role) &&
                factoryVoices[phase.role].captures.slice(1).map((capture) => {
                  const info = infos[keyOf(capture)];
                  return (
                    <li key={keyOf(capture)} className="oxidal-tone-row">
                      <span>
                        {info?.state === 'ok'
                          ? `${info.title} · ${info.size}`
                          : info?.state === 'removed'
                            ? 'Removed from TONE3000'
                            : 'Reading…'}
                      </span>
                      <Button
                        variant="outline"
                        disabled={info?.state !== 'ok'}
                        onClick={() => {
                          setOverrides((o) => ({
                            ...o,
                            [phase.role]: capture,
                          }));
                          setPhase({ name: 'pick' });
                        }}
                      >
                        Use this tone
                      </Button>
                    </li>
                  );
                })}
            </ul>
            <label className="field">
              <span>Or one of your saved tones</span>
              <Select
                onValueChange={(value) => {
                  const source = unit.sources.find(
                    (s) => s.preset.sha256 === value,
                  );
                  if (source) {
                    unit.bind(phase.role, source);
                    setPhase({ name: 'pick' });
                  }
                }}
              >
                <SelectTrigger aria-label="Saved tone">
                  <SelectValue placeholder="Choose a saved tone…" />
                </SelectTrigger>
                <SelectContent>
                  {unit.sources.map((s) => (
                    <SelectItem key={s.preset.sha256} value={s.preset.sha256}>
                      {s.preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button
                variant="outline"
                onClick={() => setPhase({ name: 'pick' })}
              >
                Back
              </Button>
            </DialogFooter>
          </>
        )}
      </div>
    </AdjustmentDialog>
  );
}
