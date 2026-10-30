import type { BlockKind, RigBlockVM, RigLaneVM } from './rigChain';
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
  parallel = false,
}: {
  lanes: RigLaneVM[];
  /** Lanes are branches of one signal: one input splits to all, one output sums them. */
  parallel?: boolean;
  /** Chain appearance preference, exposed for styling and tests. */
  appearance?: string;
  selected?: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const tiles = (lane: RigLaneVM) => (
    <div
      className="chain-blocks"
      role="region"
      aria-label={`${lane.id} chain blocks`}
      tabIndex={0}
    >
      {lane.blocks.map((block) => (
        <RigTile
          key={block.id}
          block={block}
          selected={selected === block.id}
          disabled={disabled}
          onSelect={() => onSelect(block.id)}
        />
      ))}
      {!lane.blocks.length && (
        <span className="chain-empty">Direct signal</span>
      )}
    </div>
  );
  if (parallel && lanes.length > 1)
    return (
      <div
        className="chain-view chain-parallel"
        aria-label={label}
        data-chain-view={appearance}
      >
        <span className="chain-port">IN</span>
        <div className="chain-parallel-lanes">
          {lanes.map((lane) => (
            <div
              key={lane.id}
              className="chain-lane chain-branch"
              data-dim={lane.dim || undefined}
              aria-label={`${lane.id} signal chain`}
            >
              <span
                className="chain-bus"
                data-side="split"
                aria-hidden="true"
              />
              <span className="chain-port chain-branch-number">
                {lane.input}
              </span>
              {tiles(lane)}
              <span className="chain-bus" data-side="sum" aria-hidden="true" />
            </div>
          ))}
        </div>
        <span className="chain-port">
          OUT <ArrowRight aria-hidden="true" />
        </span>
      </div>
    );
  return (
    <div className="chain-view" aria-label={label} data-chain-view={appearance}>
      {lanes.map((lane) => (
        <div
          key={lane.id}
          className="chain-lane"
          data-dim={lane.dim || undefined}
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
              <RigTile
                key={block.id}
                block={block}
                selected={selected === block.id}
                disabled={disabled}
                onSelect={() => onSelect(block.id)}
              />
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

/** One block: outlined face, category LED, short label. A tap selects. */
export function RigTile({
  block,
  selected,
  disabled,
  onSelect,
}: {
  block: RigBlockVM;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="rig-tile"
      data-kind={block.kind}
      data-on={block.on}
      aria-label={block.on ? block.label : `${block.label}, bypassed`}
      title={block.label}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="rig-tile-face">
        <span className="chain-led" aria-hidden="true" />
        {block.face}
      </span>
      <span className="rig-tile-label">{block.label}</span>
    </button>
  );
}

/** Labelled LED toggle used for block and setting on/bypass state. */
export function LedToggle({
  on,
  kind,
  label,
  disabled,
  onToggle,
  state,
}: {
  on: boolean;
  /** Overrides On/Bypassed, e.g. "Mixed" for a partially enabled branch. */
  state?: string;
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
      {state ?? (on ? 'On' : 'Bypassed')}
    </button>
  );
}
