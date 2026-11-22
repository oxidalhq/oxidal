import { ArrowSquareOut } from '@phosphor-icons/react';
import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';

import { AdjustmentDialog } from './AdjustmentDialog';
import { captureLevels, type LocalModel, toneImage } from './api';
import { GearIcon } from './GearIcon';
import { friendlyError } from './lib/friendlyError';
import { LibraryModelAudition } from './LibraryModelAudition';
import { modelSourceLink, modelToneId } from './modelProvenance';
import { ToneDetails } from './ToneDetails';

export function ModelPicture({ model }: { model: LocalModel }) {
  const [failed, setFailed] = useState(false);
  const toneId = modelToneId(model);
  return toneId && !failed ? (
    <img
      src={toneImage(toneId)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <GearIcon gear={model.gear || 'experimental'} />
  );
}

function ModelLevels({ id }: { id: string }) {
  const [levels, setLevels] =
    useState<Awaited<ReturnType<typeof captureLevels>>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function inspect() {
    setBusy(true);
    setError('');
    try {
      setLevels(await captureLevels(id));
    } catch (cause) {
      setError(friendlyError(cause, 'read the capture levels'));
    } finally {
      setBusy(false);
    }
  }
  if (levels) {
    const label = (value: number | null | undefined) =>
      value == null ? 'Unknown' : value + ' dBu';
    return (
      <dl className="m-0 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm [&>dd]:m-0 [&>dd]:break-words [&>dt]:text-muted-foreground">
        <dt>Capture input reference</dt>
        <dd>{label(levels.input_dbu)}</dd>
        <dt>Capture output reference</dt>
        <dd>{label(levels.output_dbu)}</dd>
        {levels.gear_type && (
          <>
            <dt>Capture type</dt>
            <dd>{levels.gear_type}</dd>
          </>
        )}
      </dl>
    );
  }
  return (
    <div>
      <Button variant="outline" disabled={busy} onClick={() => void inspect()}>
        {busy ? 'Reading capture…' : 'Read capture levels'}
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

/** Inspecting a file is read-only; audition is a separate, explicit live action.
 * @see docs/library.md
 */
export function LibraryModelPreview({
  model,
  onClose,
  onOpenRig,
}: {
  model: LocalModel;
  onClose: () => void;
  onOpenRig: () => void;
}) {
  const toneId = modelToneId(model);
  return (
    <AdjustmentDialog
      title="Model preview"
      onCancel={onClose}
      className="min-w-0 break-words"
    >
      <div className="space-y-4">
        {toneId ? (
          <ToneDetails
            toneId={toneId}
            initialTone={model.provider_tone ?? undefined}
          />
        ) : (
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid size-20 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-8">
              <GearIcon gear={model.gear || 'experimental'} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold">{model.nam?.name || model.title}</p>
              {model.nam?.author && (
                <p className="text-sm text-muted-foreground">
                  By {model.nam.author}
                </p>
              )}
              {model.nam?.gear && (
                <p className="text-sm text-muted-foreground">
                  {model.nam.gear}
                </p>
              )}
              {model.nam?.trainer && (
                <p className="text-sm text-muted-foreground">
                  Trained with {model.nam.trainer}
                </p>
              )}
              <p className="caption">
                Uploaded NAM
                {!modelSourceLink(model) &&
                  ' · No TONE3000 reference in this file'}
              </p>
              {modelSourceLink(model) && (
                <a
                  className="inline-flex min-h-touch w-fit items-center gap-1 font-semibold underline"
                  href={modelSourceLink(model)!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on TONE3000 <ArrowSquareOut aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        )}
        <p className="text-sm break-words text-muted-foreground">
          File: {model.name}
        </p>
        <ModelLevels id={model.id} />
        <LibraryModelAudition asset={model.id} onOpenRig={onOpenRig} />
      </div>
    </AdjustmentDialog>
  );
}
