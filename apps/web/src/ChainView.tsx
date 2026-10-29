import type { BlockKind, RigLaneVM } from './rigChain';
import { ArrowRight } from '@phosphor-icons/react';
import './ChainView.css';

/**
 * One chain for every engine: plain outlined tiles on a wire, an LED for the
 * on/bypassed state and ink inversion for selection. Tiles carry no buttons;
 * a tap selects and bypass lives in the block detail.
 * @see docs/interface.md
 */
export function ChainView({
  lanes,
  selected,
  onSelect,
  disabled,
  label,
  appearance,
}: {
  lanes: RigLaneVM[];
  /** Chain appearance preference, exposed for styling and tests. */
  appearance?: string;
  selected?: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="chain-view" aria-label={label} data-chain-view={appearance}>
      {lanes.map((lane) => (
        <div
          key={lane.id}
          className="chain-lane"
          aria-label={`${lane.id} signal chain`}
        >
          <span className="chain-port">{lane.input}</span>
          <div
            className="chain-blocks"
            role="region"
            aria-label={`${lane.id} chain blocks`}
            tabIndex={0}
          >
            {lane.blocks.map((block) => (
              <button
                key={block.id}
                type="button"
                className="rig-tile"
                data-kind={block.kind}
                data-on={block.on}
                aria-label={block.on ? block.label : `${block.label}, bypassed`}
                title={block.label}
                aria-pressed={selected === block.id}
                disabled={disabled}
                onClick={() => onSelect(block.id)}
              >
                <span className="rig-tile-face">
                  <span className="chain-led" aria-hidden="true" />
                  {block.face}
                </span>
                <span className="rig-tile-label">{block.label}</span>
              </button>
            ))}
            {!lane.blocks.length && (
              <span className="chain-empty">Direct signal</span>
            )}
          </div>
          <span className="chain-port">
            OUT <ArrowRight aria-hidden="true" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Labelled LED toggle used for block and setting on/bypass state. */
export function LedToggle({
  on,
  kind,
  label,
  disabled,
  onToggle,
}: {
  on: boolean;
  kind?: BlockKind;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="led-toggle"
      data-kind={kind}
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="chain-led" aria-hidden="true" />
      {on ? 'On' : 'Bypassed'}
    </button>
  );
}
