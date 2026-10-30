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
      <div className="add-block-list">
        {kinds.map((kind) => (
          <button
            key={kind.format}
            type="button"
            className="add-block-option"
            aria-label={kind.format === 'nam' ? 'Add NAM' : 'Add IR'}
            onClick={() => onChoose(kind.format)}
          >
            <GearIcon gear={kind.gear} />
            <span>
              <strong>{kind.title}</strong>
              <span className="caption">{kind.detail}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="caption">
        Next you choose where in the chain it goes, then the model.
      </p>
    </AdjustmentDialog>
  );
}
