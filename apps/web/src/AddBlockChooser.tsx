import { Button } from '@oxidal/design-system/components/button';
import { Caption } from '@oxidal/design-system/components/text';

import { AdjustmentDialog } from './AdjustmentDialog';
import { GearIcon } from './GearIcon';

const kinds = [
  {
    format: 'nam',
    gear: 'amp',
    title: 'Amp, pedal or rig capture',
    detail: 'A NAM model from TONE3000 or your library.',
  },
  {
    format: 'ir',
    gear: 'ir',
    title: 'Cabinet or room',
    detail: 'An impulse response (IR) for the speaker cab or space.',
  },
] as const;

/** One + Add entry point: pick what kind of block, then where, then which model. */
export function AddBlockChooser({
  onChoose,
  onCancel,
}: {
  onChoose: (format: 'nam' | 'ir') => void;
  onCancel: () => void;
}) {
  return (
    <AdjustmentDialog title="Add a block" onCancel={onCancel}>
      <div className="grid divide-y divide-border">
        {kinds.map((kind) => (
          <Button
            variant="ghost"
            key={kind.format}
            type="button"
            className="grid h-auto min-h-touch grid-cols-[2rem_minmax(0,1fr)] justify-start gap-3 rounded-none px-0 py-3 text-left whitespace-normal [&_svg]:size-7 [&>span]:grid [&>span]:gap-0.5"
            aria-label={kind.format === 'nam' ? 'Add NAM' : 'Add IR'}
            onClick={() => onChoose(kind.format)}
          >
            <GearIcon gear={kind.gear} />
            <span>
              <strong>{kind.title}</strong>
              <Caption as="span">{kind.detail}</Caption>
            </span>
          </Button>
        ))}
      </div>
      <Caption>
        Next you choose where in the chain it goes, then the model.
      </Caption>
    </AdjustmentDialog>
  );
}
