import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Caption } from '@oxidal/design-system/components/text';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import { downloadVoice } from '../../api';
import { ModelPicker } from '../../ModelPicker';
import { type DraftEffect, lv2Effect, terminalEffect } from '../../rigDraft';
import {
  type Route,
  routeInsertAt,
  routeReplace,
  routeSplitAt,
} from '../../rigRoute';
import { SlotChooser } from '../../SlotChooser';
import type { RigViewProps } from './useMixedRigSession';

/**
 * The rig canvas's choosers: a gap's + offers Add effect or Split here;
 * either, "+ Add effect" on a path and Replace… then choose the effect.
 * @see docs/interface.md
 */
export function RigChainSurfaceChooser({ rig, vm }: RigViewProps) {
  const { canvasChoice: choice, editChain, matching, setCanvasChoice } = rig;
  const { changed, fullRoute, state } = vm;
  const [format, setFormat] = useState<'nam' | 'ir' | null>(null);
  if (!choice || !state.configured) return null;
  const close = () => {
    setFormat(null);
    setCanvasChoice(null);
  };
  const insert = (effect: DraftEffect) =>
    editChain((route: Route) => {
      if (choice.kind === 'replace')
        return routeReplace(route, choice.id, effect);
      return choice.kind === 'split'
        ? routeSplitAt(route, choice.at, effect)
        : routeInsertAt(route, choice.at, effect);
    });
  if (format)
    return (
      <ModelPicker
        name={matching?.manifest.name ?? 'this rig'}
        intent="add"
        initialFormat={format}
        allowedFormat={format}
        onClose={close}
        onAudition={async () => {}}
        onTone={async (tone, model, name) => {
          const ready = await downloadVoice(tone, model, name);
          const current = rig.current.current;
          if (
            current?.session !== state.session ||
            current.configured?.revision !== state.configured?.revision
          )
            throw new Error(
              'The playing rig changed. Close and choose the insertion point again.',
            );
          const source = ready.capture.source;
          await insert({
            id: `native-${crypto.randomUUID()}`,
            kind: 'native',
            name,
            preset: source.preset,
            source: source.source,
          });
          close();
          return source.preset.sha256;
        }}
      />
    );
  if (choice.kind === 'gap')
    return (
      <AdjustmentDialog title="Add or split here" onCancel={close}>
        <div
          className="grid divide-y divide-border [&>button]:h-auto [&>button]:justify-start [&>button]:rounded-none [&>button]:py-2.5 [&>button]:text-left [&>button]:whitespace-normal"
          aria-label="Add or split"
        >
          <Button
            variant="outline"
            onClick={() => setCanvasChoice({ ...choice, kind: 'add' })}
          >
            Add effect
          </Button>
          <Button
            variant="outline"
            onClick={() => setCanvasChoice({ ...choice, kind: 'split' })}
          >
            Split here
          </Button>
        </div>
        <Caption>
          Split here makes two paths: the effect you choose on Path 1, Path 2
          empty for another effect.
        </Caption>
      </AdjustmentDialog>
    );
  return (
    <SlotChooser
      sampleRate={state.configured.stream.input.sample_rate}
      presetName={matching?.manifest.name ?? 'this preset'}
      modified={!!changed}
      allowEffects
      modelsAllowed
      placement="here"
      effectTitle={
        choice.kind === 'replace' ? 'Replace with…' : 'Add an effect'
      }
      onCancel={close}
      onModel={setFormat}
      onEffect={(plugin) => {
        close();
        void editChain((route: Route) => {
          if (choice.kind === 'replace')
            return routeReplace(route, choice.id, lv2Effect(plugin));
          const { at } = choice;
          // At the very end of the chain a Hold keeps the full spectrum.
          const end = at.split === null && at.index >= (fullRoute?.length ?? 0);
          const effect = end ? terminalEffect(plugin) : lv2Effect(plugin);
          return choice.kind === 'split'
            ? routeSplitAt(route, at, effect)
            : routeInsertAt(route, at, effect);
        });
      }}
    />
  );
}
