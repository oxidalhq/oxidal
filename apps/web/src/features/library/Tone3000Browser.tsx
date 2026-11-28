/**
 * Library › TONE3000: the shared TONE3000 browser (Storybook's
 * `ModelBrowser` with `only="tone3000"`) on the device's real catalogue.
 * Search and the Trending, gear and size filters ask TONE3000 through the
 * device; Get keeps a tone's first model on the device; Try keeps it too and
 * then plays it through a NAM block of the rig that is playing now, with the
 * same revision-checked audition as Tones and IRs.
 * @see docs/native-tone3000.md
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { Caption } from '@oxidal/design-system/components/text';
import {
  ModelBrowser,
  type ModelChoice,
} from '@oxidal/design-system/patterns/model-browser';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import { downloadVoice, stageTone3000 } from '../../api';
import { friendlyError } from '../../lib/friendlyError';
import { LibraryModelAudition } from '../../LibraryModelAudition';
import { useToneCatalogue } from './useToneCatalogue';

export function Tone3000Browser({
  connected,
  onOpenRig,
  onPlay,
  onSignIn,
}: {
  connected: boolean;
  onOpenRig: () => void;
  /** Plays a native preset by id, as Library's Play does. */
  onPlay: (preset: string, owned: boolean) => Promise<void> | void;
  onSignIn: () => void;
}) {
  const { catalogue, markKept, modelsOf } = useToneCatalogue({
    connected,
    onSignIn,
  });
  const [downloads, setDownloads] = useState<Record<string, number>>({});
  const [trying, setTrying] = useState<{ asset: string; label: string } | null>(
    null,
  );
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Keeps the tone's first model on the device; returns its device file. */
  const keep = useCallback(
    async (choice: ModelChoice) => {
      const id = Number(choice.id);
      setError('');
      setDownloads((all) => ({ ...all, [choice.id]: 50 }));
      try {
        const controller = new AbortController();
        const models = await modelsOf(id, controller.signal);
        const model = models.data[0];
        if (!model) throw new Error('This tone has no model Oxidal can play');
        const staged = await stageTone3000(id, model.id, controller.signal);
        if (alive.current) markKept(id);
        return staged.id;
      } catch (cause) {
        if (alive.current) setError(friendlyError(cause, 'keep this tone'));
        return null;
      } finally {
        if (alive.current)
          setDownloads((all) => {
            const next = { ...all };
            delete next[choice.id];
            return next;
          });
      }
    },
    [modelsOf, markKept],
  );

  /**
   * Play straight: the tone's first model as a capture on its own, with no
   * rig around it, as TONE3000's own player does. Asking again for a capture
   * already on the device reuses it.
   */
  const playStraight = useCallback(
    async (choice: ModelChoice) => {
      const id = Number(choice.id);
      setError('');
      setDownloads((all) => ({ ...all, [choice.id]: 50 }));
      try {
        const controller = new AbortController();
        const models = await modelsOf(id, controller.signal);
        const model = models.data[0];
        if (!model) throw new Error('This tone has no model Oxidal can play');
        const ready = await downloadVoice(
          id,
          model.id,
          choice.label.slice(0, 120),
        );
        if (alive.current) markKept(id);
        const { source } = ready.capture.source;
        if (source.kind === 'bundle')
          throw new Error(
            'This capture plays inside a rig only. Use Try through my rig.',
          );
        await onPlay(source.preset, source.kind === 'owned');
      } catch (cause) {
        if (alive.current) setError(friendlyError(cause, 'play this tone'));
      } finally {
        if (alive.current)
          setDownloads((all) => {
            const next = { ...all };
            delete next[choice.id];
            return next;
          });
      }
    },
    [modelsOf, markKept, onPlay],
  );

  return (
    <section aria-label="TONE3000 browser" className="grid min-w-0 gap-3">
      {error && (
        <p role="alert" className="m-0 text-sm">
          {error}
        </p>
      )}
      <ModelBrowser
        models={[]}
        only="tone3000"
        beside
        downloads={downloads}
        catalogue={catalogue}
        onGet={(choice) => void keep(choice)}
        onPlay={(choice) => void playStraight(choice)}
        onTry={(choice) =>
          void keep(choice).then((asset) => {
            if (asset) setTrying({ asset, label: choice.label });
          })
        }
      />
      {trying && (
        <AdjustmentDialog
          title={`Try ${trying.label}`}
          description="Plays it through a NAM block of the rig that is playing now."
          onCancel={() => setTrying(null)}
        >
          <LibraryModelAudition
            asset={trying.asset}
            onOpenRig={() => {
              setTrying(null);
              onOpenRig();
            }}
          />
          <Caption className="text-xs">
            The tone is kept on this unit, in Tones and IRs.
          </Caption>
        </AdjustmentDialog>
      )}
    </section>
  );
}
