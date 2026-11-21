import { useEffect, useRef, useState } from 'react';

import {
  CaptureBuilder,
  type CaptureChoice,
  type CapturePlan,
} from '@oxidal/design-system/patterns/capture-builder';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import { type LocalModel, localModels, publishCaptureRig } from '../../api';
import { friendlyError } from '../../lib/friendlyError';

function useAssetPage(format: 'nam' | 'ir', query: string) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [result, setResult] = useState<{
    query: string;
    rows: LocalModel[];
    next?: string | null;
    error?: string;
    cursor: string | null;
  }>();
  const [previous, setPrevious] = useState(query);
  if (previous !== query) {
    setPrevious(query);
    setCursor(null);
  }
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void localModels(cursor, controller.signal, true, { format, query })
        .then((page) => {
          if (!controller.signal.aborted)
            setResult((old) => ({
              query,
              cursor,
              rows: [
                ...(cursor && old?.query === query ? old.rows : []),
                ...page.data,
              ],
              next: page.next,
            }));
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setResult((old) => ({
              query,
              cursor,
              rows: old?.query === query ? old.rows : [],
              error: friendlyError(e, 'read your local files'),
            }));
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [format, query, cursor]);
  const page = result?.query === query ? result : undefined;
  return {
    rows: page?.rows ?? [],
    error: page?.error,
    loading: !page || page.cursor !== cursor,
    more: !!page?.next && page.cursor === cursor,
    advance: () => setCursor(page?.next ?? null),
  };
}

function choice(model: LocalModel): CaptureChoice[] {
  const gear = model.gear ?? model.provider_tone?.gear;
  if (gear && ['pedal', 'outboard', 'cab', 'space'].includes(gear)) return [];
  const role =
    gear === 'amp'
      ? 'amp'
      : gear === 'amp-cab' || gear === 'full-rig'
        ? 'full_rig'
        : undefined;
  return [{ id: model.id, name: model.title || model.name, role }];
}

export function CaptureRigBuilder({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const models = useAssetPage('nam', query);
  const cabinets = useAssetPage('ir', '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const previous = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function save(plan: CapturePlan) {
    if (pending.current) return;
    const key = JSON.stringify(plan);
    const token =
      previous.current?.key === key ? previous.current.id : crypto.randomUUID();
    previous.current = { key, id: token };
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      const saved = await publishCaptureRig(
        { ...plan, request_id: token },
        controller.signal,
      );
      if (!controller.signal.aborted) onSaved(saved.manifest.name);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(friendlyError(e, 'save the capture rig'));
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function cancel() {
    pending.current?.abort();
    onClose();
  }
  return (
    <AdjustmentDialog title="Build a rig from captures" onCancel={cancel}>
      <CaptureBuilder
        models={models.rows.flatMap(choice)}
        cabinets={cabinets.rows.map((m) => ({
          id: m.id,
          name: m.title || m.name,
        }))}
        busy={busy}
        error={error || models.error || cabinets.error}
        search={query}
        onSearch={setQuery}
        more={models.more}
        loading={models.loading}
        onMore={models.advance}
        cabinetMore={cabinets.more}
        onMoreCabinets={cabinets.advance}
        onSave={(plan) => void save(plan)}
        onCancel={cancel}
      />
    </AdjustmentDialog>
  );
}
