import type { BlockSource } from '../widgets/block-source';

/** A model a block can load, as far as its source goes. */
type Choice = {
  label: string;
  kind: 'amp' | 'cab' | 'pedal';
  from: 'mine' | 'tone3000';
  creator?: string;
  licence?: string;
  origin?: BlockSource;
};

/**
 * Where a model comes from, for the block that loads it: the model's own
 * source record when it has one, else what its list entry says.
 */
export function originOf(choice: Choice): BlockSource {
  if (choice.origin) return choice.origin;
  if (choice.from === 'tone3000')
    return {
      kind: 'tone3000',
      title: choice.label,
      creator: { name: choice.creator ?? 'A TONE3000 creator' },
      page: 'https://www.tone3000.com',
      gear:
        choice.kind === 'amp' ? 'Amp' : choice.kind === 'cab' ? 'Cab' : 'Pedal',
      licence: choice.licence ?? 'See TONE3000',
    };
  return {
    kind: 'file',
    title: choice.label,
    type: choice.kind === 'cab' ? 'IR' : 'NAM',
    author: 'You',
  };
}
