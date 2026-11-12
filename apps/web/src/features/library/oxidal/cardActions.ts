import type {
  CardState,
  MissingTone,
  SoundItem,
  UnitFacts,
} from './oxidalSounds.model';
import { roleLabel, sceneLine } from './oxidalSounds.model';
import type { OxidalSounds } from './useOxidalSounds';

/** What each card state offers as its one primary action, and its text line.
 * @see docs/factory-collection.md */

/** What a card's one primary action does; the browser supplies the handlers. */
export type CardHandlers = {
  getTones: (item: SoundItem) => void;
  signIn: (item: SoundItem) => void;
};

export type Primary = {
  label: string;
  disabled: boolean;
  /** Why it is disabled, shown beside the card's actions. */
  reason?: string;
  run: () => void;
};

/** Every missing tone is already downloaded: adding them needs no TONE3000. */
const allKept = (missing: MissingTone[]) =>
  missing.length > 0 && missing.every((t) => t.named && t.kept !== undefined);

const PROTECT_REASON =
  'Protect is on, so packs cannot be installed. Turn Protect off in Settings first.';
const AUDIO_REASON = 'Stop audio before installing packs.';

/** The single primary action for a card state, or null when there is none. */
export function primaryFor(
  item: SoundItem,
  state: CardState,
  unit: OxidalSounds,
  handlers: CardHandlers,
): Primary | null {
  const idle = unit.connected && !unit.busy;
  switch (state.kind) {
    case 'ready':
      return {
        label: 'Play',
        disabled: !idle,
        run: () => void unit.play(item),
      };
    case 'build':
      return {
        label: 'Play',
        disabled: !idle || !unit.profile,
        run: () => void unit.play(item),
      };
    case 'tone':
      return {
        label: allKept(state.missing) ? 'Add tones' : 'Get tones',
        disabled: !idle,
        run: () => handlers.getTones(item),
      };
    case 'signed-out':
      return {
        label: 'Sign in to TONE3000',
        disabled: !unit.connected,
        run: () => handlers.signIn(item),
      };
    case 'pack': {
      const facts: UnitFacts = unit.facts;
      const reason = facts.protectOn
        ? PROTECT_REASON
        : facts.audioRunning
          ? AUDIO_REASON
          : undefined;
      return {
        label: 'Install pack',
        disabled: !idle || !!reason,
        reason,
        run: () => void unit.installPacks(state.packs),
      };
    }
    default:
      return null;
  }
}

/** The line under the title: what the sound needs, or its scenes when ready. */
export function cardLine(
  item: SoundItem,
  state: CardState,
  unit: OxidalSounds,
): string {
  switch (state.kind) {
    case 'ready':
      return `Scenes: ${sceneLine(item.sceneNames)}`;
    case 'build':
      return 'Everything is installed.';
    case 'tone':
      return allKept(state.missing)
        ? 'Its tones are downloaded on this unit. Add them to play it.'
        : `Needs: ${state.missing.map((t) => roleLabel(t.role)).join(' · ')}`;
    case 'signed-out':
      return `Needs ${state.missing.length} ${state.missing.length === 1 ? 'tone' : 'tones'} from your TONE3000 account.`;
    case 'pack':
      return `Needs: ${state.packs.map(unit.packName).join(' · ')}`;
    case 'heavy':
      return `${state.count} captures; your stream fits ${state.limit}.`;
    case 'unavailable':
      return state.plugins.every((name) => name.startsWith('Oxidal '))
        ? `Needs ${state.plugins.join(', ')}, which comes with a newer Oxidal system. Update this unit to play it.`
        : `Needs ${state.plugins.join(', ')}, which no effect pack provides. Install it on this unit, then open Library again.`;
    case 'loading':
      return '';
  }
}
