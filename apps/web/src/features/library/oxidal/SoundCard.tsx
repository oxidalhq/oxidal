import { Button } from '@oxidal/design-system/components/button';
import { glyphFor, glyphs } from '@oxidal/design-system/lib/block-glyphs';
import {
  type OxidalSound,
  SoundRecipeRow,
} from '@oxidal/design-system/patterns/sound-browser';

import './oxidal.css';
import { recipeEffects } from '../../../factoryRecipes';
import { type CardHandlers, cardLine, primaryFor } from './cardActions';
import {
  type CardState,
  complexityLabel,
  engineLabel,
  roleLabel,
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
  const blocks: OxidalSound['blocks'] = item.recipe
    ? recipeEffects(item.recipe).map((block) => {
        if ('native' in block)
          return { label: roleLabel(block.native), kind: 'amp' };
        const kind = glyphs[glyphFor('lv2', block.plugin)].kind;
        return { label: block.plugin, kind: kind === 'other' ? 'lv2' : kind };
      })
    : [];
  return (
    <SoundRecipeRow
      as="article"
      rowLabel={item.name}
      state={state.kind}
      sound={{
        name: item.name,
        era: item.recipe?.era,
        genres: item.meta.genres,
        description: item.description,
        blocks,
      }}
      onSelect={onDetails}
      selectLabel={`Details: ${item.name}`}
      summary={`${engineLabel(item.meta.engine)} · ${complexityLabel(item.meta.complexity)}`}
      badge={
        <span className="rounded-full border px-2 py-0.5 text-xs">
          {chip(state)}
        </span>
      }
      action={
        primary && (
          <Button
            size="sm"
            disabled={primary.disabled}
            aria-label={`${primary.label}: ${item.name}`}
            onClick={primary.run}
          >
            {primary.label}
          </Button>
        )
      }
      feedback={
        <>
          <span>{cardLine(item, state, unit)}</span>
          {reason && <span>{reason}</span>}
          {unit.failures[item.key] && (
            <p role="alert">{unit.failures[item.key]}</p>
          )}
        </>
      }
    />
  );
}
