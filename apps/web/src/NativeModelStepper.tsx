import { useEffect, useRef, useState } from 'react';

import { ModelStepper } from '@oxidal/design-system/widgets/model-stepper';

import { type AudioState, type LocalModel, localModels } from './api';
import { friendlyError } from './lib/friendlyError';

function captureKind(gear?: string) {
  const normalized = gear
    ?.trim()
    .toLowerCase()
    .replace(/\s*\+\s*|\s+/g, '-');
  switch (normalized) {
    case 'amp':
    case 'combo':
      return 'amp';
    case 'amp-cab':
    case 'full-rig':
      return 'full rig';
    case 'pedal':
    case 'outboard':
    case 'experimental':
    case 'space':
      return normalized;
    case 'cab':
    case 'ir':
      return 'cab';
  }
}

export function NativeModelStepper({
  state,
  block,
  name,
  gear,
  disabled,
  onAudition,
}: {
  state: AudioState;
  block: string;
  name: string;
  gear?: string;
  disabled: boolean;
  onAudition: (opening: AudioState, asset: string) => Promise<AudioState>;
}) {
  const [catalog, setCatalog] = useState<LocalModel[]>([]);
  const [trail, setTrail] = useState<{
    request: number;
    origin: string | null;
    name: string;
    kind?: ReturnType<typeof captureKind>;
  } | null>(null);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const knownKind = captureKind(gear);
  const hintedFormat =
    knownKind === 'cab' || knownKind === 'space'
      ? 'ir'
      : knownKind ||
          state.controls.some(
            ({ target }) => target === `block:${block}:slimSize`,
          )
        ? 'nam'
        : undefined;
  const active = state.models?.find((model) => model.target === block)?.asset;
  const needCatalog = !!(hintedFormat || active);
  // Read four local pages at most. Change… can search the full library.
  useEffect(() => {
    if (!needCatalog) return;
    const abort = new AbortController();
    async function load() {
      const files = new Map<string, LocalModel>();
      let cursor: string | null = null;
      for (let i = 0; i < 4; i++) {
        const page = await localModels(
          cursor,
          abort.signal,
          true,
          hintedFormat ? { format: hintedFormat, query: '' } : undefined,
        );
        for (const file of page.data) files.set(file.id, file);
        cursor = page.next ?? null;
        if (!cursor) break;
      }
      if (!abort.signal.aborted) setCatalog([...files.values()]);
    }
    void load().catch(() => {
      if (!abort.signal.aborted) setCatalog([]);
    });
    return () => abort.abort();
  }, [hintedFormat, needCatalog]);

  const activeEntry = catalog.find((file) => file.id === active);
  const progress = state.model_change;
  const ownsComparison =
    trail &&
    progress?.request === trail.request &&
    progress.assignment.target === block;
  const kind =
    (ownsComparison ? trail.kind : undefined) ??
    captureKind(activeEntry?.gear) ??
    knownKind;
  const format = activeEntry?.format ?? hintedFormat;
  const ready = catalog.filter((file) => {
    if (file.format !== format) return false;
    const candidate = captureKind(file.gear);
    return !kind || !candidate || candidate === kind;
  });
  const index = ready.findIndex((file) => file.id === active);
  const restore =
    ownsComparison &&
    trail.origin &&
    active &&
    active !== trail.origin &&
    ready.some((file) => file.id === trail.origin)
      ? trail.origin
      : null;
  const canStep = ready.length > 0 && (ready.length > 1 || index < 0);
  if (!canStep && !ownsComparison) return null;

  async function request(asset: string) {
    if (disabled || sending.current || asset === active) return;
    setError('');
    sending.current = true;
    try {
      const reply = await onAudition(state, asset);
      if (
        !reply.model_change ||
        reply.model_change.assignment.target !== block ||
        reply.model_change.assignment.asset !== asset ||
        reply.session !== state.session
      )
        throw new Error('The playing block did not accept this audition.');
      setTrail({
        request: reply.model_change.request,
        origin: ownsComparison ? trail.origin : (active ?? null),
        name: ownsComparison ? trail.name : name,
        kind,
      });
    } catch (cause) {
      setError(friendlyError(cause, 'audition this model'));
    } finally {
      sending.current = false;
    }
  }
  return (
    <>
      <ModelStepper
        label={`Try another ${kind ?? (format === 'ir' ? 'cab' : 'capture')} model`}
        name={name}
        count={ready.length}
        index={index}
        units={format === 'ir' ? 'IRs' : 'models'}
        disabled={disabled}
        stepDisabled={!canStep}
        backLabel={trail ? `Back to ${trail.name}` : undefined}
        backUnavailable={
          !active || (ownsComparison && !trail.origin)
            ? 'Starting capture is embedded in the preset and cannot be restored here'
            : undefined
        }
        onStep={(direction) => {
          if (!canStep) return;
          const next =
            index < 0
              ? direction > 0
                ? 0
                : ready.length - 1
              : (index + direction + ready.length) % ready.length;
          void request(ready[next]!.id);
        }}
        onBack={restore ? () => void request(restore) : undefined}
      />
      {error && <p role="alert">{error}</p>}
    </>
  );
}
