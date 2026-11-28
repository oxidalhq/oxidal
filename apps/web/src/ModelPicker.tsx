/**
 * Change… and Get: choosing a NAM model or IR for a block, as Storybook's
 * Swap sheet draws it, on the shared `ModelBrowser`: search, the TONE3000
 * collections and gear filters, pictures, and the models on this unit, all
 * in one list. Trying one auditions it through the block (the caller's
 * `onAudition`, or `onTone` to build a new block from a TONE3000 capture).
 * A file from this device can still be uploaded and auditioned.
 * @see docs/native-tone3000.md
 */
import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { DialogFooter } from '@oxidal/design-system/components/dialog';
import { Caption } from '@oxidal/design-system/components/text';
import {
  ModelBrowser,
  type ModelChoice,
} from '@oxidal/design-system/patterns/model-browser';
import { DockableSheet } from '@oxidal/design-system/patterns/tool-dock';

import {
  type LocalModel,
  localModels,
  stageLocalCollection,
  stageTone3000,
  uploadLocalModel,
} from './api';
import {
  choiceOf,
  useToneCatalogue,
} from './features/library/useToneCatalogue';
import { friendlyError } from './lib/friendlyError';
import { gearLabel } from './lib/gearLabel';
import { setReturnTarget } from './lib/sessionState';

/** A model on this unit as the shared browser shows it. */
function deviceChoice(model: LocalModel): ModelChoice {
  const tone = model.provider_tone;
  const ir = model.format === 'ir';
  const kind: ModelChoice['kind'] =
    ir || model.gear === 'cab' || model.gear === 'space'
      ? 'cab'
      : model.gear === 'pedal'
        ? 'pedal'
        : 'amp';
  return {
    id: model.id,
    label: model.title,
    caption: [
      model.gear ? gearLabel(model.gear) : 'File',
      ir ? 'IR' : 'NAM',
      model.name && model.name !== model.title ? model.name : null,
    ]
      .filter(Boolean)
      .join(' · '),
    kind,
    from: 'mine',
    origin: tone ? choiceOf(tone, true).origin : undefined,
  };
}

export function ModelPicker({
  name,
  intent = 'replace',
  initialFormat = 'nam',
  allowedFormat,
  onClose,
  onAudition,
  onTone,
  comparison,
  inline = false,
  onSignIn,
  returnFocus,
}: {
  name: string;
  returnFocus?: () => HTMLElement | null;
  /** Shown in a page (Library) instead of a sheet. */
  inline?: boolean;
  /** Opens Accounts when browsing needs a TONE3000 sign-in. */
  onSignIn?: () => void;
  comparison?: {
    pending: boolean;
    appliedAsset?: string;
    error?: string | null;
    blocked?: boolean;
  };
  intent?: 'add' | 'replace' | 'download';
  initialFormat?: 'nam' | 'ir';
  allowedFormat?: 'nam' | 'ir';
  onClose: () => void;
  onAudition: (asset: string) => Promise<void>;
  /** Build a new host block from a selected TONE3000 capture. */
  onTone?: (tone: number, model: number, name: string) => Promise<string>;
}) {
  const format = allowedFormat ?? initialFormat;
  const [files, setFiles] = useState<File[]>([]);
  const [local, setLocal] = useState<LocalModel[]>([]);
  const [localNext, setLocalNext] = useState<string | null>(null);
  const [localAfter, setLocalAfter] = useState<string | null>(null);
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState<'download' | 'assign' | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [choice, setChoice] = useState<{
    asset: string;
    label: string;
    /** The browser row it came from. */
    id: string;
  } | null>(null);
  const locked = !!busy || !!comparison?.pending || !!comparison?.blocked;
  const download = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      download.current?.abort();
    };
  }, []);
  function close() {
    if (busy === 'assign') return;
    download.current?.abort();
    onClose();
  }
  const signIn =
    onSignIn ??
    (() => {
      setReturnTarget({
        hash: window.location.hash || '#rig',
        label: intent === 'download' ? 'Sounds' : 'Rig',
      });
      close();
      window.location.hash = 'settings/accounts';
    });
  const { catalogue, markKept, modelsOf } = useToneCatalogue({
    connected: true,
    onSignIn: signIn,
  });
  // Models on this unit join the list, except when only TONE3000 is asked for.
  const deviceToo = !onTone && intent !== 'download';
  useEffect(() => {
    if (!deviceToo) return;
    const controller = new AbortController();
    localModels(localAfter, controller.signal, true).then(
      (page) => {
        if (controller.signal.aborted) return;
        setLocal((previous) => {
          const seen = new Set(previous.map((m) => m.id));
          return localAfter
            ? [...previous, ...page.data.filter((m) => !seen.has(m.id))]
            : page.data;
        });
        setLocalNext(page.next ?? null);
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setLocalError(friendlyError(cause, 'read local model files'));
      },
    );
    return () => controller.abort();
  }, [localAfter, deviceToo]);

  /** A TONE3000 tone: its chosen model (or its first) through the block. */
  async function auditionTone(toneId: number, label: string, variant?: string) {
    if (locked) return;
    const controller = new AbortController();
    download.current = controller;
    setBusy(onTone ? 'assign' : 'download');
    setUploading(false);
    setError('');
    setDownloads((all) => ({ ...all, [String(toneId)]: 50 }));
    try {
      const models = await modelsOf(toneId, controller.signal, allowedFormat);
      const modelId = variant ? Number(variant) : models.data[0]?.id;
      if (!modelId)
        throw new Error(
          allowedFormat === 'ir'
            ? 'This tone has no IR for this block.'
            : 'This tone has no model Oxidal can play here.',
        );
      const asset = onTone
        ? { id: await onTone(toneId, modelId, label) }
        : await stageTone3000(toneId, modelId, controller.signal);
      if (controller.signal.aborted || !alive.current) return;
      markKept(toneId);
      setBusy('assign');
      if (!onTone) await onAudition(asset.id);
      if (alive.current) {
        setChoice({
          asset: asset.id,
          label:
            models.data.find((model) => model.id === modelId)?.name ?? label,
          id: String(toneId),
        });
        if (!comparison) onClose();
      }
    } catch (cause) {
      if (!controller.signal.aborted && alive.current)
        setError(friendlyError(cause, 'read the sounds'));
    } finally {
      if (alive.current) {
        setBusy(null);
        setDownloads((all) => {
          const next = { ...all };
          delete next[String(toneId)];
          return next;
        });
      }
    }
  }
  /** A model on this unit, or the files chosen from this device. */
  async function auditionLocal(asset?: string) {
    if (locked || (!asset && files.length === 0)) return;
    const controller = new AbortController();
    download.current = controller;
    setBusy(asset ? 'assign' : 'download');
    setUploading(!asset);
    setError('');
    try {
      if (!asset) {
        const formats = files.map((file) =>
          file.name.split('.').at(-1)?.toLowerCase(),
        );
        if (formats.some((f) => f !== 'nam' && f !== 'wav'))
          throw new Error('Choose .nam or .wav files.');
        if (new Set(formats).size !== 1)
          throw new Error(
            'Choose only NAM files or only IR files for one collection.',
          );
        const fileFormat = formats[0] === 'nam' ? 'nam' : 'ir';
        if (allowedFormat && fileFormat !== allowedFormat)
          throw new Error(
            `Choose ${allowedFormat === 'ir' ? 'IR WAV' : 'NAM'} files for this stage.`,
          );
        if (files.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024)
          throw new Error('Collection must fit within 32 MiB.');
        const ids: string[] = [];
        for (const file of files) {
          if (controller.signal.aborted || !alive.current) return;
          ids.push((await uploadLocalModel(file, controller.signal)).id);
        }
        asset =
          ids.length === 1
            ? ids[0]!
            : (await stageLocalCollection(ids, controller.signal)).id;
      }
      if (controller.signal.aborted || !alive.current) return;
      setBusy('assign');
      await onAudition(asset);
      if (alive.current) {
        setChoice({
          asset,
          id: asset,
          label:
            (local.find((model) => model.id === asset)?.title ??
              files.map((file) => file.name).join(', ')) ||
            'Local model',
        });
        if (!comparison) onClose();
      }
    } catch (cause) {
      if (!controller.signal.aborted && alive.current)
        setError(friendlyError(cause, 'read the sounds'));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  // Replacing keeps the block's kind: a model for a model, an IR for an IR.
  const only = allowedFormat ?? (intent === 'replace' ? initialFormat : null);
  const deviceChoices = local
    .filter((m) => !only || m.format === only)
    .map(deviceChoice);
  const title =
    intent === 'download'
      ? `Get ${format === 'nam' ? 'NAM models' : 'IRs'}`
      : 'Choose model';
  const body = (
    <div className="grid min-w-0 content-start gap-3">
      {intent !== 'download' && (
        <Caption className="truncate">
          {intent === 'add' ? 'Add to' : 'Replace'} {name}
        </Caption>
      )}
      <ModelBrowser
        models={deviceToo ? deviceChoices : []}
        only={deviceToo ? undefined : 'tone3000'}
        kind={only === 'ir' ? 'cab' : undefined}
        downloads={downloads}
        disabled={locked}
        // Marked sounding only once the comparison confirms it is applied.
        playing={
          choice &&
          !comparison?.blocked &&
          comparison?.appliedAsset === choice.asset
            ? choice.id
            : null
        }
        catalogue={catalogue}
        onTry={(picked, variant) =>
          picked.from === 'mine'
            ? void auditionLocal(picked.id)
            : void auditionTone(Number(picked.id), picked.label, variant)
        }
        onGet={
          intent === 'download'
            ? (picked) => void auditionTone(Number(picked.id), picked.label)
            : undefined
        }
      />
      {deviceToo && localNext && (
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={locked}
          onClick={() => setLocalAfter(localNext)}
        >
          More files on this unit
        </Button>
      )}
      {localError && <p role="alert">{localError}</p>}
      {deviceToo && (
        <details className="border-t border-border pt-2 [&>summary]:flex [&>summary]:min-h-touch [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:text-sm [&>summary]:font-semibold">
          <summary>Add a file from this device</summary>
          <div className="grid gap-3 pt-2">
            <label htmlFor="local-model-file" className="text-sm">
              NAM / IR file
            </label>
            <input
              id="local-model-file"
              className="w-full min-w-0"
              type="file"
              multiple
              accept={
                allowedFormat === 'nam'
                  ? '.nam'
                  : allowedFormat === 'ir'
                    ? '.wav'
                    : '.nam,.wav'
              }
              disabled={locked}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={files.length === 0 || locked}
              onClick={() => void auditionLocal()}
            >
              {files.length > 1
                ? `Audition ${files.length} files`
                : 'Audition file'}
            </Button>
          </div>
        </details>
      )}
      <Caption>
        {intent === 'download'
          ? 'Downloads stay in your library for future presets. Downloading does not change the playing sound.'
          : 'Audition changes live sound; closing keeps it. Save a copy in Rig for offline use.'}
      </Caption>
      {comparison?.pending && (
        <p role="status">
          Preparing comparison… Close leaves this request running.
        </p>
      )}
      {choice &&
        !comparison?.blocked &&
        comparison?.appliedAsset === choice.asset && (
          <p role="status">Auditioning {choice.label}</p>
        )}
      {(comparison?.blocked || error || comparison?.error) && (
        <p role="alert">
          {comparison?.blocked
            ? 'The playing preset changed. Close and reopen the model browser.'
            : error || comparison?.error}
        </p>
      )}
      {inline && choice && !busy && (
        <p role="status">{choice.label} is saved in Sounds.</p>
      )}
      {busy && (
        <p role="status">
          {busy === 'download'
            ? uploading
              ? 'Uploading for audition…'
              : intent === 'download'
                ? 'Downloading to library…'
                : 'Downloading for audition…'
            : intent === 'download'
              ? 'Adding to library…'
              : 'Preparing live audition…'}
        </p>
      )}
      {(!inline || busy === 'download') && (
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy === 'assign'}
            onClick={inline ? () => download.current?.abort() : close}
          >
            {busy === 'download'
              ? uploading
                ? 'Cancel upload'
                : 'Cancel download'
              : 'Close'}
          </Button>
        </DialogFooter>
      )}
    </div>
  );
  return inline ? (
    <section className="mx-auto w-full max-w-2xl" aria-label="TONE3000 sounds">
      {body}
    </section>
  ) : (
    <DockableSheet
      id="change"
      title={title}
      closeLabel="Close dialog"
      returnFocus={returnFocus}
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      className="md:w-[min(52rem,100vw)]"
    >
      {body}
    </DockableSheet>
  );
}
