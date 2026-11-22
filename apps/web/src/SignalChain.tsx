import { ArrowRight } from '@phosphor-icons/react';

import { Button } from '@oxidal/design-system/components/button';

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
        className="chain-tile h-full min-h-24 w-full min-w-0 flex-col items-start justify-start gap-2 px-2 py-3 text-left wrap-anywhere whitespace-normal aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:ring-inset max-[380px]:px-1.5"
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
        className="chain-tile flex min-h-24 min-w-0 flex-col items-start gap-2 rounded-md border border-input px-2 py-3 wrap-anywhere aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:ring-inset max-[380px]:px-1.5"
        data-testid={`block-${id}`}
      >
        {content}
      </div>
    );
  }
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)] items-center gap-y-1 py-3 min-[851px]:grid-cols-[minmax(0,1fr)_2rem_minmax(0,1.35fr)]"
      aria-label={
        parallel
          ? 'Input to parallel NAM paths, then delay, reverb and output'
          : 'Input to NAM, delay, reverb and output'
      }
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] items-center max-[850px]:grid-cols-[minmax(0,1fr)_2rem_minmax(0,2fr)]">
        {tile('input', 'Input', 'Instrument')}
        <div
          className="flex flex-col items-center justify-center gap-1 place-self-center text-2xs"
          aria-hidden="true"
        >
          <ArrowRight size={18} />
          {parallel && <span>Split</span>}
        </div>
        <div className="grid gap-2 max-[850px]:grid-cols-[repeat(auto-fit,minmax(5rem,1fr))]">
          {tile('nam-a', 'NAM A', parallel ? 'Path A · Level' : 'Level')}
          {parallel && tile('nam-b', 'NAM B', 'Path B · Level')}
        </div>
      </div>
      <div
        className="flex flex-col items-center justify-center gap-1 place-self-center text-2xs max-[850px]:min-h-8 max-[850px]:flex-row max-[850px]:[&>svg]:rotate-90"
        aria-hidden="true"
      >
        <ArrowRight size={18} />
        {parallel && <span>A + B</span>}
      </div>
      <div className="chain-effects grid min-w-0 grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)_1.25rem_minmax(0,1fr)] items-stretch max-[380px]:grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)_1rem_minmax(0,1fr)]">
        {tile('delay', 'Delay', 'Mix')}
        <ArrowRight
          className="flex flex-col items-center justify-center gap-1 place-self-center text-2xs"
          size={16}
          aria-hidden="true"
        />
        {tile('reverb', 'Reverb', 'Mix')}
        <ArrowRight
          className="flex flex-col items-center justify-center gap-1 place-self-center text-2xs"
          size={16}
          aria-hidden="true"
        />
        {tile('output', 'Output', 'Level')}
      </div>
    </div>
  );
}
