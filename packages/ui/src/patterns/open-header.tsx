import { MagnifyingGlass } from '@phosphor-icons/react';

import { Button } from '../components/ui/button';
import { cn } from '../lib/cn';
import { HealthStatus } from '../widgets/health-status';
import type {
  ResourceReadings,
  ResourceState,
} from '../widgets/resource-strip';
import type { BarLevels } from './display-bar';
import { PeakMeter, type RigDestination } from './rig-top-bar';

/**
 * The open header: one slim row with no band of its own, over the page. The
 * wordmark on the left, the main menu in the middle as small-caps labels with
 * a short bar under each (oxide under the page you are on), and search, the
 * input and output peaks and the health pill on the right. Once the page
 * scrolls, or the chain is panned under it, it takes the page colour with a
 * soft blur and one hairline along its bottom. The E-paper, Sunlight and
 * Night display modes always get a solid page colour and no blur. On a phone
 * the menu is left to the bottom tabs.
 * @see docs/interface.md
 */

/** Height of the open header, for content that starts under it. */
export const OPEN_HEADER_HEIGHT = 56;

/** The main menu, in order. */
const MENU: { id: RigDestination; label: string }[] = [
  { id: 'rig', label: 'Rig' },
  { id: 'guitars', label: 'Guitars' },
  { id: 'library', label: 'Library' },
  { id: 'levels', label: 'Levels' },
  { id: 'settings', label: 'Settings' },
  { id: 'tools', label: 'Tools' },
];

/** Display modes that need firm ground under text. */
const FIRM =
  '[[data-display=epaper]_&]:bg-background [[data-display=epaper]_&]:backdrop-blur-none [[data-display=sunlight]_&]:bg-background [[data-display=sunlight]_&]:backdrop-blur-none [[data-display=stage]_&]:bg-background [[data-display=stage]_&]:backdrop-blur-none';

export function OpenHeader({
  destination,
  onNavigate,
  levels,
  readings,
  state = 'live',
  onSearch,
  onDetails,
  solid = false,
  className,
}: {
  destination: RigDestination;
  onNavigate: (destination: RigDestination) => void;
  levels?: BarLevels | null;
  readings: ResourceReadings;
  state?: ResourceState;
  onSearch: () => void;
  /** Opens the device details behind the health pill. */
  onDetails?: () => void;
  /** Something is under the header: the page has scrolled or the chain is panned. */
  solid?: boolean;
  className?: string;
}) {
  return (
    <header
      data-slot="open-header"
      data-solid={solid || undefined}
      className={cn(
        'z-20 grid h-14 grid-cols-[1fr_auto] items-center gap-4 border-b border-transparent px-page transition-[background-color,border-color] duration-[var(--duration-fast)] md:grid-cols-[1fr_auto_1fr]',
        'data-solid:border-border data-solid:bg-background/85 data-solid:backdrop-blur-md',
        FIRM,
        className,
      )}
    >
      <a
        href="#rig"
        aria-label="Oxidal home"
        onClick={(event) => {
          event.preventDefault();
          onNavigate('rig');
        }}
        className="flex h-10 items-center justify-self-start"
      >
        {/* Ink on paper; the Night display mode is dark, so its wordmark is light. */}
        <img
          src="/brand/wordmark.svg"
          alt=""
          className="h-5 w-auto [[data-display=stage]_&]:hidden"
        />
        <img
          src="/brand/wordmark-white.svg"
          alt=""
          className="hidden h-5 w-auto [[data-display=stage]_&]:block"
        />
      </a>
      <nav
        aria-label="Instrument navigation"
        className="flex items-center gap-1 max-md:hidden"
      >
        {MENU.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={destination === item.id ? 'page' : undefined}
            onClick={() => onNavigate(item.id)}
            className="group grid min-h-10 content-center justify-items-center gap-1 rounded-md px-2.5 small-caps text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:text-foreground"
          >
            {item.label}
            <span
              aria-hidden="true"
              className="h-0.5 w-4 rounded-full bg-border transition-[width,background-color] duration-[var(--duration-fast)] group-hover:bg-muted-foreground group-aria-[current=page]:w-6 group-aria-[current=page]:bg-brand"
            />
          </button>
        ))}
      </nav>
      <div className="flex items-center gap-2 justify-self-end">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Search"
          title="Search presets, blocks and settings"
          onClick={onSearch}
        >
          <MagnifyingGlass />
        </Button>
        {levels && (
          <span className="flex items-center gap-4 px-1 max-xl:hidden">
            <PeakMeter tone="page" label="In" values={levels.input} />
            <PeakMeter tone="page" label="Out" values={levels.output} />
          </span>
        )}
        <HealthStatus
          readings={readings}
          state={state}
          onDetails={onDetails}
          className="min-h-9 shrink-0"
        />
      </div>
    </header>
  );
}
