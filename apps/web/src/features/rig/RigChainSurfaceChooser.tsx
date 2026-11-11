import { AdjustmentDialog } from '../../AdjustmentDialog';
import { Button } from '../../components/ui/button';
import { SlotChooser } from '../../SlotChooser';
import { lv2Effect, terminalEffect } from '../../rigDraft';
import {
  routeInsertAt,
  routeReplace,
  routeSplitAt,
  type Route,
} from '../../rigRoute';
import type { RigViewProps } from './useMixedRigSession';

/**
 * The rig canvas's choosers (S-15): a gap's + offers Add effect or Split here;
 * either, "+ Add effect" on a path and Replace… then choose the effect.
 * @see docs/interface.md
 */
export function RigChainSurfaceChooser({ rig, vm }: RigViewProps) {
  const { canvasChoice: choice, editChain, matching, setCanvasChoice } = rig;
  const { changed, fullRoute, state } = vm;
  if (!choice || !state.configured) return null;
  const close = () => setCanvasChoice(null);
  if (choice.kind === 'gap')
    return (
      <AdjustmentDialog title="Add or split here" onCancel={close}>
        <div className="menu-list" aria-label="Add or split">
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
        <p className="caption">
          Split here makes two paths: the effect you choose on Path 1, Path 2
          empty for another effect.
        </p>
      </AdjustmentDialog>
    );
  return (
    <SlotChooser
      sampleRate={state.configured.stream.input.sample_rate}
      presetName={matching?.manifest.name ?? 'this preset'}
      modified={!!changed}
      allowEffects
      modelsAllowed={false}
      placement="here"
      effectTitle={
        choice.kind === 'replace' ? 'Replace with…' : 'Add an effect'
      }
      onCancel={close}
      onModel={close}
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
