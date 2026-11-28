import {
  List,
  MagnifyingGlass,
  MusicNotes,
  Pause,
  Play,
} from '@phosphor-icons/react';
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Separator } from '../components/ui/separator';
import {
  duration as T,
  EASE_IN,
  EASE_OUT,
  SPRING,
  STILL,
  useGlowOnce,
} from '../lib/capsule-motion';
import { cn } from '../lib/cn';
import {
  type CapsulePhase,
  useCapsuleSqueeze,
} from '../lib/use-capsule-squeeze';
import { useMedia } from '../lib/use-media';
import { MuteToggle, type RigDestination } from './rig-top-bar';

/**
 * The floating capsule: the whole top of every screen. The wordmark on the
 * left and one glass capsule in the middle. At rest the capsule shows the
 * menu button, the page you are on, a status dot and Mute; hover, focus or a
 * tap opens it to every page, search and the status word. While audio plays
 * and nothing has happened for a few seconds, the wordmark and the capsule
 * squeeze into one small bubble (the Oxidal mark and Mute) so the chain has
 * the screen; the pointer near the top, a key, or a tap on the bubble brings
 * it back. Mute is reachable in every state. E-paper keeps it open and solid.
 * @see docs/interface.md
 */

export type { CapsulePhase } from '../lib/use-capsule-squeeze';

/** One entry in the capsule's ☰ menu. */
export type CapsuleMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Shut down device and the like. */
  destructive?: boolean;
  disabled?: boolean;
  /** An item that is on or off, such as a tool that is open. */
  checked?: boolean;
};

/** A page in the capsule's row of pages. */
export type CapsulePage = { id: RigDestination; label: string };

const PAGES: CapsulePage[] = [
  { id: 'rig', label: 'Rig' },
  { id: 'guitars', label: 'Guitars' },
  { id: 'library', label: 'Library' },
  { id: 'levels', label: 'Levels' },
  { id: 'settings', label: 'Settings' },
];

/** How long the capsule stays open after the pointer leaves it. */
const CLOSE_AFTER = 500;

/**
 * A part of the capsule. Its width morphs (a light spring when popping open),
 * and its contents cross-fade with a small scale and blur shift, sliding in
 * from the capsule's end it sits at.
 */
function Part({
  state,
  pop,
  from = 'none',
  order = 0,
  className,
  children,
}: {
  state: 'on' | 'off' | 'half';
  /** Coming back out of the bubble: a short spring. */
  pop: boolean;
  /** Which end of the capsule it slides in from. */
  from?: 'start' | 'end' | 'none';
  /** Its place in the stagger when the capsule opens. */
  order?: number;
  className?: string;
  children: ReactNode;
}) {
  const off = state === 'off';
  const on = state === 'on';
  return (
    <span
      data-part={state}
      aria-hidden={off || undefined}
      inert={off}
      style={{
        transitionDuration: T(on ? 280 : 260),
        transitionTimingFunction: on ? (pop ? SPRING : EASE_OUT) : EASE_IN,
        transitionDelay: on
          ? `calc(${order * 35}ms * var(--c2-speed, 1))`
          : '0ms',
      }}
      className={cn(
        'grid transition-[grid-template-columns,opacity,scale,translate,filter,visibility] transition-discrete',
        on && 'translate-x-0 scale-100 grid-cols-[1fr] opacity-100 blur-none',
        // Half-shown parts can still be pressed: no scaling, so a touch
        // target keeps its full 44 px.
        state === 'half' && 'grid-cols-[0.5fr] opacity-50 blur-[2px]',
        // Hidden once it has faded: not a target, not in the way.
        off && 'invisible scale-[0.96] grid-cols-[0fr] opacity-0 blur-[4px]',
        off && from === 'start' && '-translate-x-1.5',
        off && from === 'end' && 'translate-x-1.5',
        STILL,
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap">
        {children}
      </span>
    </span>
  );
}

/** Every control in the capsule: the control height, 44 px on touch. */
const pill =
  'inline-flex min-h-control-xs shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-[600px]:min-h-touch [@media(pointer:coarse)]:min-h-touch';
/** An icon-only control: square, the same height as the labelled ones. */
const square =
  'size-control-xs justify-center px-0 max-[600px]:size-touch [@media(pointer:coarse)]:size-touch';

export function FloatingCapsule({
  destination,
  onNavigate,
  pages = PAGES,
  status,
  muted,
  onMute,
  muteDisabled = false,
  onSearch,
  statusDetails,
  menu,
  menuNote,
  playing,
  inputLevel = null,
  keepOpen = false,
  idleMs = 3000,
  phase: fixedPhase,
  defaultMenuOpen = false,
  preset,
  actions,
  openExtras,
  media,
  midi,
  wordmark = '/brand/wordmark.svg',
  statusAlways = false,
  className,
}: {
  destination: RigDestination;
  onNavigate: (destination: RigDestination) => void;
  /** The pages in its row; Rig, Guitars, Library, Levels and Settings by default. */
  pages?: CapsulePage[];
  /** One word for the device, and whether something needs attention. */
  status: { word: string; problem?: boolean };
  muted: boolean;
  onMute: (muted: boolean) => void;
  /** Mute waits for the device to say whether it is muted, or for a change to finish. */
  muteDisabled?: boolean;
  onSearch: () => void;
  /**
   * The opened capsule shows this in place of the status word, such as the
   * device health chip whose popover holds every reading.
   */
  statusDetails?: ReactNode;
  /** The ☰ menu: groups of items, with a line between groups. */
  menu: CapsuleMenuItem[][];
  /** A short line at the top of the ☰ menu on a phone, such as the stream and engine. */
  menuNote?: string;
  /** Audio is running: the capsule may squeeze into the bubble while a guitar plays. */
  playing: boolean;
  /** The guitar's input level in dBFS: it squeezes only while a guitar is playing. */
  inputLevel?: number | null;
  /** Settings › Display › Keep the menu open while playing. */
  keepOpen?: boolean;
  /** Quiet time before it squeezes. */
  idleMs?: number;
  /** Hold one state, for a picture of it; leave out to let it move by itself. */
  phase?: CapsulePhase;
  defaultMenuOpen?: boolean;
  /**
   * The playing preset in the capsule (the Rig): its picker takes the page
   * label's place, and the bubble shows its name beside the wordmark. The
   * page labels and the status word then appear only when the capsule opens.
   */
  preset?: { name: string; picker: ReactNode };
  /** Always beside the preset while the capsule is not a bubble, such as Perform. */
  actions?: ReactNode;
  /** Shown only while the capsule is open, before search, such as Tuner. */
  openExtras?: ReactNode;
  /**
   * A backing track that is playing or paused partway: a small now-playing
   * part opens the player, and the bubble shows a note while it plays. A
   * track only cued at the start, or played to the end, is left out: it
   * waits in the player.
   */
  media?: {
    title: string;
    playing: boolean;
    /** "1:12", or something that keeps its own time, so the page does not redraw. */
    position: ReactNode;
    /** Work running beside it, such as "Splitting 64%". */
    work?: string;
    onOpen: () => void;
  };
  /** The foot controller, shown as a small light in the opened capsule on a phone. */
  midi?: { name: string; connected: boolean };
  /** The wordmark image. */
  wordmark?: string;
  /** Settings › Display › Status: the light and its word stay at rest too. */
  statusAlways?: boolean;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const narrow = useMedia('(max-width: 39.99rem)');
  // Narrower than this the opened capsule's extras sit in a tray under it.
  const narrowTray = useMedia('(max-width: 47.99rem)');
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(defaultMenuOpen);
  const [epaper, setEpaper] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mark = useRef<HTMLSpanElement>(null);
  // The capsule reaches the wordmark: the wordmark steps aside until it is
  // clear again. Measured, so it holds for any mix of preset, track and width.
  const [crowded, setCrowded] = useState(false);
  useEffect(() => {
    const el = root.current;
    const m = mark.current;
    const nav = el?.querySelector('nav');
    if (!el || !m || !nav || typeof ResizeObserver === 'undefined') return;
    // Layout offsets, not boxes: the wordmark's own slide must not count.
    const check = () =>
      setCrowded(
        m.offsetWidth > 0 && nav.offsetLeft < m.offsetLeft + m.offsetWidth + 12,
      );
    const ro = new ResizeObserver(check);
    ro.observe(nav);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, []);

  // E-paper does not animate: the header stays in its working state.
  useEffect(() => {
    const el = root.current;
    setEpaper(
      !!el?.closest('[data-display=epaper]') ||
        document.documentElement.dataset.display === 'epaper',
    );
  }, []);

  const squeeze = useCapsuleSqueeze({
    running: playing && !fixedPhase,
    inputLevel,
    keepOpen,
    busy: open || menuOpen,
    idleMs,
    epaper,
    target: root,
  });

  const phase: CapsulePhase =
    fixedPhase ??
    (squeeze.squeezed
      ? 'bubble'
      : open || menuOpen || epaper
        ? 'open'
        : 'rest');
  const bubble = phase === 'bubble';
  const mid = phase === 'squeezing';
  const wide = phase === 'open';
  const part = (show: boolean): 'on' | 'off' | 'half' =>
    mid ? 'half' : show ? 'on' : 'off';
  // The parts only an open capsule has stay out of the squeeze.
  const extra = (): 'on' | 'off' => (wide ? 'on' : 'off');
  const pop = squeeze.popping && !bubble;

  const keepOpenNow = () => {
    if (closing.current) clearTimeout(closing.current);
    setOpen(true);
  };
  const closeSoon = () => {
    if (closing.current) clearTimeout(closing.current);
    closing.current = setTimeout(() => setOpen(false), CLOSE_AFTER);
  };
  // A pressed tray button on a phone: the tray folds away whether or not
  // the button keeps the focus (a toggle such as Edit does).
  const foldTray = () => {
    if (closing.current) clearTimeout(closing.current);
    // Reaching for the capsule again (focus, the pointer) keeps it open.
    closing.current = setTimeout(() => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && root.current?.contains(focused))
        focused.blur();
      setOpen(false);
    }, CLOSE_AFTER);
  };
  // Listened to on the element itself: what the screen draws in the tray
  // arrives through a portal, whose clicks React passes up its own tree.
  const foldOnPress = useEffectEvent(() => {
    if (narrowTray) foldTray();
  });
  const [trayElement, tray] = useState<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!trayElement) return;
    const on = () => foldOnPress();
    trayElement.addEventListener('click', on, true);
    return () => trayElement.removeEventListener('click', on, true);
  }, [trayElement]);
  const wakeUp = () => {
    squeeze.wake();
    keepOpenNow();
  };

  // A problem while it is a bubble: the edge turns oxide and glows once.
  const glow = useGlowOnce<HTMLElement>(bubble && !!status.problem);
  // The pointer reaching the capsule opens it and leaving lets it close.
  // Listened to on the element: React's own enter and leave did not arrive
  // when the pointer came from the page under the header.
  const onEnter = useEffectEvent(() => (bubble ? wakeUp() : keepOpenNow()));
  const onLeave = useEffectEvent(() => closeSoon());
  useEffect(() => {
    const el = glow.current;
    if (!el) return;
    const enter = () => onEnter();
    const leave = () => onLeave();
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
    };
  }, [glow]);

  const here = pages.findIndex((p) => p.id === destination);
  const before = here > 0 ? pages.slice(0, here) : [];
  const after = here >= 0 ? pages.slice(here + 1) : pages;
  const current = pages[here];
  const pageButton = (p: CapsulePage) => (
    <button
      key={p.id}
      type="button"
      aria-current={p.id === destination ? 'page' : undefined}
      onClick={() => onNavigate(p.id)}
      className={cn(
        pill,
        // Only the page you are on has a fill. Hover darkens the word, so a
        // page beside it never looks chosen too.
        'small-caps text-muted-foreground hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground',
      )}
    >
      {p.label}
    </button>
  );
  const rule = <Separator orientation="vertical" className="mx-1 h-5" />;
  const searchButton = (
    <button
      type="button"
      aria-label="Search"
      title="Search presets, blocks and settings"
      onClick={onSearch}
      className={cn(
        pill,
        square,
        'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <MagnifyingGlass className="size-4" aria-hidden />
    </button>
  );
  // A phone with a preset keeps its row for the preset: search joins the
  // opened capsule's tray.
  const searchInTray = narrow && !!preset && !!openExtras;

  return (
    <div
      ref={root}
      data-slot="floating-capsule"
      data-phase={phase}
      data-status={statusAlways ? 'always' : 'problem'}
      data-idle-ms={squeeze.idleMs}
      className={cn(
        'pointer-events-none relative z-30 flex h-12 items-center px-page',
        className,
      )}
    >
      {/* The wordmark slides in towards the bubble as the header squeezes. */}
      <span
        ref={mark}
        aria-hidden={bubble || crowded || undefined}
        style={{
          transitionDuration: T(300),
          transitionTimingFunction: bubble ? EASE_IN : pop ? SPRING : EASE_OUT,
        }}
        className={cn(
          'pointer-events-auto absolute left-page transition-[translate,opacity,filter]',
          // A phone centres the capsule; the bubble carries the wordmark.
          'max-sm:hidden',
          // A preset or a track widens the capsule; under 1024 px it needs the room.
          (preset || media) && 'max-lg:hidden',
          // The opened capsule reaches the wordmark: it steps aside until
          // the capsule closes, rather than sitting under the glass.
          crowded && 'pointer-events-none opacity-0',
          bubble && 'translate-x-[30vw] opacity-0 blur-[4px]',
          mid && 'translate-x-[15vw] opacity-50 blur-[2px]',
          STILL,
        )}
      >
        <img src={wordmark} alt="Oxidal" className="h-5 w-auto" />
      </span>

      <nav
        ref={glow}
        aria-label="Main menu"
        onFocus={() => (bubble ? wakeUp() : keepOpenNow())}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            closeSoon();
        }}
        className={cn(
          // Nested radius: the buttons' radius plus the capsule's 4 px padding.
          'pointer-events-auto relative mx-auto flex max-w-full min-w-0 items-center rounded-[calc(var(--radius-lg)+0.25rem)] border p-1 transition-[border-color] duration-300',
          // Glass: the page shows faintly through a mostly solid surface, so text keeps its contrast.
          'border-border/80 bg-card/85 shadow-[inset_0_1px_0_var(--color-background),0_8px_24px_rgb(0_0_0/0.08)] backdrop-blur-md',
          '[[data-display=epaper]_&]:bg-background [[data-display=epaper]_&]:shadow-none [[data-display=epaper]_&]:backdrop-blur-none [[data-display=stage]_&]:backdrop-blur-none [[data-display=sunlight]_&]:bg-background [[data-display=sunlight]_&]:backdrop-blur-none',
          bubble && status.problem && 'border-brand',
        )}
      >
        <Part state={part(!bubble)} pop={pop}>
          <DropdownMenu
            // Not modal: the capsule and Mute stay reachable while it is open.
            modal={false}
            open={menuOpen}
            onOpenChange={(o) => {
              setMenuOpen(o);
              if (o) wakeUp();
            }}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Menu"
                className={cn(
                  pill,
                  square,
                  'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <List className="size-4" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-60 motion-safe:animate-arrive"
            >
              {menuNote && (
                <>
                  <p className="m-0 px-3 py-2 font-mono text-xs text-muted-foreground tabular-nums md:hidden">
                    {menuNote}
                  </p>
                  <DropdownMenuSeparator className="md:hidden" />
                </>
              )}
              {preset && (
                // The open capsule hides the page names below a laptop's
                // width when a preset needs the room: they are here instead.
                <div className="xl:hidden">
                  <DropdownMenuGroup>
                    {pages.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        aria-current={p.id === destination ? 'page' : undefined}
                        onSelect={() => onNavigate(p.id)}
                      >
                        {p.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                </div>
              )}
              {menu.map((group, g) => (
                <DropdownMenuGroup key={g}>
                  {g > 0 && <DropdownMenuSeparator />}
                  {group.map((item) =>
                    item.checked === undefined ? (
                      <DropdownMenuItem
                        key={item.id}
                        destructive={item.destructive}
                        disabled={item.disabled}
                        onSelect={item.onSelect}
                      >
                        {item.icon} {item.label}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuCheckboxItem
                        key={item.id}
                        checked={item.checked}
                        disabled={item.disabled}
                        onSelect={item.onSelect}
                      >
                        {item.icon} {item.label}
                      </DropdownMenuCheckboxItem>
                    ),
                  )}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {rule}
        </Part>

        <Part state={part(bubble)} pop={pop}>
          <button
            type="button"
            aria-label={[
              preset ? `Show menu: ${preset.name}` : 'Show menu',
              media?.playing && 'a track is playing',
            ]
              .filter(Boolean)
              .join(', ')}
            onClick={wakeUp}
            className={cn(pill, 'max-w-[18rem] hover:bg-accent')}
          >
            <img src={wordmark} alt="" className="h-4 w-auto" />
            {preset && (
              <span aria-hidden="true" className="min-w-0 truncate">
                · {preset.name.replace(/^Oxidal · /, '')}
              </span>
            )}
            {media?.playing && (
              <MusicNotes
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            )}
          </button>
        </Part>

        {preset ? (
          <>
            <Part
              state={extra()}
              pop={pop}
              from="start"
              // With a preset the row also holds its name, Perform and the
              // Rig's tools: page names need a laptop's width, and the ☰ menu
              // has them below that (a BOOX at 930 px squeezed the name to "A").
              className="max-xl:hidden"
            >
              {pages.map(pageButton)}
              {rule}
            </Part>
            <Part state={part(!bubble)} pop={pop}>
              {preset.picker}
            </Part>
            {actions && (
              <Part
                state={part(!bubble)}
                pop={pop}
                // Perform keeps its width; the preset's name gives way.
                className="shrink-0 [&:has([data-capsule-slot]:empty)]:hidden"
              >
                {rule}
                {actions}
              </Part>
            )}
          </>
        ) : (
          <>
            <Part
              state={extra()}
              pop={pop}
              from="start"
              className="max-md:hidden"
            >
              {before.map(pageButton)}
            </Part>
            <Part state={part(!bubble)} pop={pop}>
              {current && pageButton(current)}
            </Part>
            <Part
              state={extra()}
              pop={pop}
              from="end"
              order={1}
              className="max-md:hidden"
            >
              {after.map(pageButton)}
            </Part>
          </>
        )}
        {openExtras && (
          <Part
            state={extra()}
            pop={pop}
            from="end"
            order={1}
            // A phone has no room in the row: the opened capsule shows them
            // in a small tray under it, the same glass and height.
            className={cn(
              '[&:has([data-capsule-slot]:empty)]:hidden',
              'max-md:absolute max-md:inset-x-0 max-md:top-full max-md:mx-auto max-md:mt-1.5 max-md:w-max max-md:max-w-full max-md:rounded-[calc(var(--radius-lg)+0.25rem)] max-md:border max-md:border-border/80 max-md:bg-card/95 max-md:p-1 max-md:shadow-[0_8px_24px_rgb(0_0_0/0.08)] max-md:[&>span>[data-slot=separator]:first-child]:hidden [[data-display=epaper]_&]:max-md:bg-background [[data-display=epaper]_&]:max-md:shadow-none',
            )}
          >
            {rule}
            {/* A pressed tray button has done its job: on a phone the tray
                folds away shortly after, so it never covers the page. */}
            <span ref={tray} className="contents">
              {searchInTray && searchButton}
              {openExtras}
            </span>
          </Part>
        )}

        {!searchInTray && (
          <Part state={extra()} pop={pop} from="end" order={2}>
            {rule}
            {searchButton}
            {rule}
          </Part>
        )}

        {statusDetails ? (
          // Always in reach of a screen reader; at rest only its light shows,
          // opened its word too, and in the bubble it steps aside.
          <span
            data-slot="capsule-status"
            className={cn(
              'inline-flex shrink-0 items-center',
              // As C2: at rest the light shows only when something needs
              // attention; the opened capsule shows it (and its word).
              (bubble || (!wide && !status.problem && !statusAlways)) &&
                'sr-only',
              (narrow || (!wide && !statusAlways)) &&
                '[&_[data-slot=health-status]]:px-1.5 [&_[data-slot=health-word]]:sr-only',
            )}
          >
            {statusDetails}
          </span>
        ) : (
          <Part
            state={preset ? extra() : part(!bubble)}
            pop={pop}
            from={preset ? 'end' : 'none'}
            order={3}
          >
            <span
              role="status"
              aria-label={status.word}
              className="inline-flex min-h-control-xs items-center gap-1.5 px-2 text-sm font-medium"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-2 rounded-full',
                  status.problem ? 'bg-brand' : 'bg-foreground',
                )}
              />
              <Part state={extra()} pop={pop} from="end" order={3}>
                <span aria-hidden="true">{status.word}</span>
              </Part>
              {midi && (
                <Part
                  state={extra()}
                  pop={pop}
                  from="end"
                  order={4}
                  className="md:hidden"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'ml-1 size-2 rounded-full',
                      midi.connected
                        ? 'bg-led-pedal'
                        : 'border border-muted-foreground',
                    )}
                  />
                  <span className="sr-only">
                    {midi.connected
                      ? `${midi.name} connected`
                      : 'No controller'}
                  </span>
                </Part>
              )}
            </span>
          </Part>
        )}

        {media && (
          <Part state={part(!bubble)} pop={pop} className="max-md:hidden">
            {rule}
            <button
              type="button"
              data-slot="capsule-media"
              title="Open the player, stems and sheet"
              onClick={media.onOpen}
              className={cn(
                pill,
                'max-w-[16rem] text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <MusicNotes className="size-4 shrink-0" aria-hidden="true" />
              <span className="max-w-[12rem] min-w-0 truncate text-foreground">
                {media.title}
              </span>
              {media.playing ? (
                <Play className="size-3 shrink-0" aria-hidden="true" />
              ) : (
                <Pause className="size-3 shrink-0" aria-hidden="true" />
              )}
              <span className="font-mono text-xs tabular-nums">
                {media.position}
              </span>
              {media.work && (
                <span className="truncate text-xs max-lg:hidden">
                  · {media.work}
                </span>
              )}
            </button>
            {rule}
          </Part>
        )}
        <MuteToggle
          size="xs"
          muted={muted}
          onMute={onMute}
          disabled={muteDisabled}
          compact={bubble || narrow}
          // Borderless like the rest of the capsule; pressed, it inverts.
          className={cn(
            'data-[state=off]:border-transparent',
            (bubble || narrow) && square,
          )}
        />
        <span className="sr-only" aria-live="polite">
          {bubble && status.problem ? status.word : ''}
        </span>
      </nav>
    </div>
  );
}
