import './oxidal.css';
import { Button } from '../../../components/ui/button';
import { type CardHandlers, cardLine, primaryFor } from './cardActions';
import {
  type CardState,
  complexityLabel,
  engineLabel,
  type SoundItem,
} from './oxidalSounds.model';
import type { OxidalSounds } from './useOxidalSounds';

const chip = (state: CardState): string => {
  switch (state.kind) {
    case 'ready':
      return '● Ready';
    case 'build':
      return '● Ready';
    case 'tone':
      return `${state.missing.length} ${state.missing.length === 1 ? 'tone' : 'tones'} needed`;
    case 'signed-out':
      return 'Sign-in needed';
    case 'pack':
      return `${state.packs.length} ${state.packs.length === 1 ? 'pack' : 'packs'} needed`;
    case 'heavy':
      return state.fitsAt
        ? `⚠ Needs ${state.fitsAt}-frame buffer`
        : '⚠ Too heavy';
    case 'unavailable':
      return 'Update needed';
    case 'loading':
      return 'Checking…';
  }
};

function heavyReason(state: Extract<CardState, { kind: 'heavy' }>) {
  return state.fitsAt
    ? `Fits at a ${state.fitsAt}-frame buffer, which adds delay. Play is not offered at the current buffer.`
    : 'Too heavy for this unit at any buffer it offers.';
}

export function SoundCard({
  item,
  state,
  unit,
  handlers,
  onDetails,
}: {
  item: SoundItem;
  state: CardState;
  unit: OxidalSounds;
  handlers: CardHandlers;
  onDetails: () => void;
}) {
  const primary = primaryFor(item, state, unit, handlers);
  const reason = state.kind === 'heavy' ? heavyReason(state) : primary?.reason;
  return (
    <article
      className="oxidal-card"
      aria-label={item.name}
      data-state={state.kind}
    >
      <div className="oxidal-card-top">
        <div>
          <h4>{item.name}</h4>
          <p className="caption">
            {item.meta.genres.join(' · ')} · {engineLabel(item.meta.engine)} ·{' '}
            {complexityLabel(item.meta.complexity)}
          </p>
        </div>
        <span className="oxidal-chip">{chip(state)}</span>
      </div>
      <p className="caption">{cardLine(item, state, unit)}</p>
      {unit.failures[item.key] && <p role="alert">{unit.failures[item.key]}</p>}
      <div className="oxidal-card-actions">
        {primary && (
          <Button
            disabled={primary.disabled}
            aria-label={`${primary.label}: ${item.name}`}
            onClick={primary.run}
          >
            {primary.label}
          </Button>
        )}
        <Button
          variant="ghost"
          aria-label={`Details: ${item.name}`}
          onClick={onDetails}
        >
          Details
        </Button>
        {reason && <span className="oxidal-reason caption">{reason}</span>}
      </div>
    </article>
  );
}
