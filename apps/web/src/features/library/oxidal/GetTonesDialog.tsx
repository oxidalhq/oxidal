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
      size: string;
      model: number;
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
    let found: { id: number; size?: string | null } | undefined;
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
      size: found.size ?? '',
      model: found.id,
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
  | { name: 'run'; step: number; total: number }
  | { name: 'done'; revision: string }
  | {
      name: 'fail';
      role: FactoryRole;
      title: string;
      removed: boolean;
      message: string;
    }
  | { name: 'alt'; role: FactoryRole };

/**
 * Get tones: one dialog for every tone a sound still needs, with sizes from the
 * player's TONE3000 account, progress, then Ready and Play. A tone that was
 * removed fails cleanly and nothing is saved.
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
  const [phase, setPhase] = useState<Phase>({ name: 'pick' });
  const [attempt, setAttempt] = useState(0);
  const stop = useRef(false);
  const total = new Set(item.recipe ? factoryRoles(item.recipe) : []).size;
  const captureOf = (tone: MissingTone): Capture | null =>
    tone.named
      ? (overrides[tone.role] ?? { tone: tone.tone, model: tone.model })
      : null;
  const keyOf = (c: Capture) => `${c.tone}:${c.model ?? ''}`;

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
  useEffect(() => {
    const controller = new AbortController();
    for (const [capture, format] of JSON.parse(wanted) as [
      string,
      'nam' | 'ir',
    ][]) {
      const [tone, model] = capture.split(':');
      void describeTone(
        { tone: Number(tone), model: model ? Number(model) : undefined },
        controller.signal,
        format,
      ).then((info) => {
        if (!controller.signal.aborted)
          setInfos((current) => ({ ...current, [capture]: info }));
      });
    }
    return () => controller.abort();
  }, [wanted, attempt]);

  const unbound = initial.filter(
    (t) => !t.named && !unit.facts.bindings[t.role],
  );
  const pending = initial.filter((t) => !unit.facts.bindings[t.role]);
  const removed = pending.filter((t) => {
    const c = captureOf(t);
    return c && infos[keyOf(c)]?.state === 'removed';
  });
  const checking = pending.some((t) => {
    const c = captureOf(t);
    return c && !infos[keyOf(c)];
  });
  const failures = pending.flatMap((t) => {
    const c = captureOf(t);
    const info = c ? infos[keyOf(c)] : undefined;
    return info?.state === 'error' ? [{ role: t.role, ...info }] : [];
  });
  const unreadable = failures.length > 0;
  // One line per different reason, naming the tones it applies to.
  const reasons = [...new Set(failures.map((f) => f.message))].map(
    (message) => {
      const same = failures.filter((f) => f.message === message);
      return {
        message,
        tones: same.map((f) => roleLabel(f.role)),
        details: [...new Set(same.map((f) => f.detail))],
      };
    },
  );

  async function go() {
    stop.current = false;
    unit.setFailure(item.key, null);
    const chosen: Partial<Record<FactoryRole, RigNativeSource>> = {};
    const jobs = initial.filter((t) => t.named && !unit.facts.bindings[t.role]);
    try {
      for (const [index, tone] of jobs.entries()) {
        if (stop.current) return;
        setPhase({ name: 'run', step: index + 1, total: jobs.length });
        const capture = captureOf(tone)!;
        const info = infos[keyOf(capture)];
        const title = info?.state === 'ok' ? info.title : roleLabel(tone.role);
        try {
          if (info?.state !== 'ok') throw new Error('Tone not read');
          const ready = await downloadVoice(
            capture.tone,
            info.model,
            title.slice(0, 120),
          );
          chosen[tone.role] = ready.capture.source;
          unit.bind(tone.role, ready.capture.source);
        } catch (cause) {
          const gone =
            (await describeTone(capture, new AbortController().signal))
              .state === 'removed';
          if (gone)
            unit.setFailure(
              item.key,
              `"${title}" was removed from TONE3000. Nothing was saved.`,
            );
          setPhase({
            name: 'fail',
            role: tone.role,
            title,
            removed: gone,
            message: friendlyError(cause, `download ${title}`),
          });
          return;
        }
      }
      if (stop.current) return;
      setPhase({ name: 'run', step: jobs.length, total: jobs.length });
      const revision = await unit.build(item, [], chosen);
      if (revision) {
        setPhase({ name: 'done', revision });
        // Other sounds that share these tones are complete now as well.
        void unit.finishReady();
      } else onClose();
    } catch (cause) {
      setPhase({
        name: 'fail',
        role: initial[0]!.role,
        title: item.name,
        removed: false,
        message: friendlyError(cause, `build ${item.name}`),
      });
    }
  }

  const title = `Get tones for ${item.name}`;
  const running = phase.name === 'run';
  return (
    <AdjustmentDialog
      title={title}
      onCancel={() => {
        if (!running) onClose();
      }}
    >
      <div className="control-stack oxidal-tones">
        {phase.name === 'pick' && (
          <>
            <p>
              From your TONE3000 account. Oxidal downloads them to this unit.
            </p>
            <ul className="oxidal-tone-list">
              {initial.map((tone) => {
                const capture = captureOf(tone);
                const info = capture ? infos[keyOf(capture)] : undefined;
                return (
                  <li key={tone.role} className="oxidal-tone-row">
                    {capture ? (
                      <>
                        <span>
                          {info?.state === 'ok'
                            ? `${info.title} · by ${info.creator}`
                            : roleLabel(tone.role)}
                          {info?.state === 'removed' &&
                            ' · removed from TONE3000'}
                          {info?.state === 'error' &&
                            ' · could not read (reason below)'}
                          {!info && ' · reading…'}
                        </span>
                        <span className="caption">
                          {info?.state === 'ok' ? info.size : ''}
                        </span>
                        {info?.state === 'removed' && (
                          <Button
                            variant="outline"
                            onClick={() =>
                              setPhase({ name: 'alt', role: tone.role })
                            }
                          >
                            Choose another tone…
                          </Button>
                        )}
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
              Already on this unit: {total - initial.length} of {total}
            </p>
            {unit.sources.length === 0 && unbound.length > 0 && (
              <p className="caption">
                No saved tones yet. Download or import one in Tones and IRs
                first.
              </p>
            )}
            {unreadable && (
              <div role="alert" className="oxidal-tone-errors">
                {reasons.map((reason) => (
                  <div key={reason.message}>
                    <p>
                      {reason.message}
                      {failures.length > 1 && ` (${reason.tones.join(', ')})`}
                    </p>
                    <details>
                      <summary className="caption">Details</summary>
                      {reason.details.map((detail) => (
                        <code key={detail} className="caption">
                          {detail}
                        </code>
                      ))}
                    </details>
                  </div>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              {unreadable && (
                <Button
                  variant="outline"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  Try again
                </Button>
              )}
              <Button
                disabled={
                  unit.busy ||
                  checking ||
                  removed.length > 0 ||
                  !!unreadable ||
                  unbound.length > 0
                }
                onClick={() => void go()}
              >
                Download
              </Button>
            </DialogFooter>
          </>
        )}
        {phase.name === 'run' && (
          <>
            <p role="status">
              {unit.progress
                ? `${unit.progress.label} · Step ${unit.progress.current + 1} of ${unit.progress.steps.length} · ${unit.progress.steps[unit.progress.current]}`
                : phase.step < phase.total
                  ? `Downloading ${phase.step} of ${phase.total} …`
                  : 'Saving the preset …'}
            </p>
            <progress
              aria-label="Progress"
              max={Math.max(1, phase.total)}
              value={Math.max(0, phase.step - 1)}
            />
            <DialogFooter>
              <Button
                variant="outline"
                disabled={unit.busy}
                onClick={() => {
                  stop.current = true;
                  onClose();
                }}
              >
                Cancel
              </Button>
            </DialogFooter>
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
              <strong>Failed:</strong>{' '}
              {phase.removed
                ? `"${phase.title}" was removed from TONE3000.`
                : phase.message}
            </p>
            <p className="caption">
              Nothing was saved. Tones that finished downloading stay in Tones
              and IRs.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              {phase.removed ? (
                <Button
                  onClick={() => setPhase({ name: 'alt', role: phase.role })}
                >
                  Choose another tone…
                </Button>
              ) : (
                <Button onClick={() => setPhase({ name: 'pick' })}>
                  Try again
                </Button>
              )}
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
