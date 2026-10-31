import { useState } from 'react';
import { GearIcon } from './GearIcon';
import { ToneDetails } from './ToneDetails';
import { AdjustmentDialog } from './AdjustmentDialog';
import { toneImage, type LocalModel } from './api';
import { LibraryModelAudition } from './LibraryModelAudition';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { modelSourceLink, modelToneId } from './modelProvenance';

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
      className="library-model-preview"
    >
      <div className="space-y-4">
        {toneId ? (
          <ToneDetails
            toneId={toneId}
            initialTone={model.provider_tone ?? undefined}
          />
        ) : (
          <div className="local-model-details">
            <div className="local-model-placeholder">
              <GearIcon gear={model.gear || 'experimental'} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold">{model.nam?.name || model.title}</p>
              {model.nam?.author && (
                <p className="library-meta">By {model.nam.author}</p>
              )}
              {model.nam?.gear && (
                <p className="library-meta">{model.nam.gear}</p>
              )}
              {model.nam?.trainer && (
                <p className="library-meta">Trained with {model.nam.trainer}</p>
              )}
              <p className="caption">
                Uploaded NAM
                {!modelSourceLink(model) &&
                  ' · No TONE3000 reference in this file'}
              </p>
              {modelSourceLink(model) && (
                <a
                  className="tone-details-link"
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
        <p className="library-meta break-words">File: {model.name}</p>
        <LibraryModelAudition asset={model.id} onOpenRig={onOpenRig} />
      </div>
    </AdjustmentDialog>
  );
}
