import { ArrowRight } from '@phosphor-icons/react';
import { Button } from './components/ui/button';
import type { Snapshot } from './api';

type Props = {
  state: Snapshot;
  parallel: boolean;
  selectedBlock: string;
  connected: boolean;
  onSelect: (block: string, parameter: string) => void;
};

/** Equal-sized instrument tiles; routing stays explicit when the rack wraps.
 * @see docs/architecture.md
 */
export function SignalChain({
  state,
  parallel,
  selectedBlock,
  connected,
  onSelect,
}: Props) {
  function tile(id: string, name: string, detail: string) {
    const parameter = state.parameters.find((p) => p.id.startsWith(`${id}.`));
    const content = (
      <>
        <span className="font-mono text-xs tabular-nums">
          {parameter
            ? `${Math.round(parameter.value * 100)}%`
            : id === 'input'
              ? 'IN'
              : (
                  state.rig.nodes.find((n) => n.id === id)?.kind ?? 'block'
                ).toUpperCase()}
        </span>
        <strong className="text-base leading-tight whitespace-nowrap">
          {name}
        </strong>
        <span className="text-xs">{detail}</span>
      </>
    );
    return parameter ? (
      <Button
        variant="outline"
        className="chain-tile h-full min-h-24 w-full min-w-0 flex-col items-start justify-start gap-2 px-2 py-3 text-left whitespace-normal"
        data-testid={`block-${id}`}
        aria-label={`Focus ${name} controls`}
        aria-pressed={selectedBlock === id}
        disabled={!connected}
        onClick={() => onSelect(id, parameter.id)}
      >
        {content}
      </Button>
    ) : (
      <div
        className="chain-tile flex min-h-24 min-w-0 flex-col items-start gap-2 rounded-md border border-input px-2 py-3"
        data-testid={`block-${id}`}
      >
        {content}
      </div>
    );
  }
  return (
    <div
      className="chain-flow"
      aria-label={
        parallel
          ? 'Input to parallel NAM paths, then delay, reverb and output'
          : 'Input to NAM, delay, reverb and output'
      }
    >
      <div className="chain-source">
        {tile('input', 'Input', 'Instrument')}
        <div className="chain-link" aria-hidden="true">
          <ArrowRight size={18} />
          {parallel && <span>Split</span>}
        </div>
        <div className="chain-branches">
          {tile('nam-a', 'NAM A', parallel ? 'Path A · Level' : 'Level')}
          {parallel && tile('nam-b', 'NAM B', 'Path B · Level')}
        </div>
      </div>
      <div className="chain-link chain-merge" aria-hidden="true">
        <ArrowRight size={18} />
        {parallel && <span>A + B</span>}
      </div>
      <div className="chain-effects">
        {tile('delay', 'Delay', 'Mix')}
        <ArrowRight className="chain-link" size={16} aria-hidden="true" />
        {tile('reverb', 'Reverb', 'Mix')}
        <ArrowRight className="chain-link" size={16} aria-hidden="true" />
        {tile('output', 'Output', 'Level')}
      </div>
    </div>
  );
}
