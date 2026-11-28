import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { layoutOf } from '../lib/dock-layout';
import { C2Sample } from './floating-capsule.demo';
import { C2PerformSample } from './floating-capsule.perform.demo';

/**
 * Header option C2 · Floating capsule. The wordmark and one glass capsule are
 * the whole top: at rest it shows the menu, the page you are on, a status
 * dot and Mute; hover, focus or a tap opens it to every page, search and the
 * status word. While audio plays and nothing happens for a few seconds the
 * wordmark and capsule squeeze into one small bubble (the Oxidal mark and
 * Mute); the pointer near the top, a key, or a tap brings it back. The Rig
 * shows faint readouts along the chain's edges. Try the Interactive story:
 * switch Playing on and shorten the idle time.
 */
const meta: Meta<typeof C2Sample> = {
  title: 'Header layouts/C2 - Floating capsule',
  component: C2Sample,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          'The capsule keeps the top almost empty and gives the chain the screen while you play. Works: calm, Mute is always in the same place, problems still show on the bubble. Watch: the menu is one hover or tap away, and the squeeze must never surprise a player mid-edit (any input in the chain resets the timer).',
          '',
          '**Rules: it folds only when it will not get in the way.** It folds into the bubble only while a guitar is actually playing (audio running and the input above −50 dBFS for 2 s) and nothing has happened for the quiet time (3 s). It never folds while a menu, sheet, dialog or the preset list is open, while text is selected or a field has focus, or within 5 s of a click. It wakes on intent: the pointer resting 150 ms in the top 80 px, or moving clearly up towards it; a fast pass across the top while dragging a block does not wake it; any key, a tap on the bubble or opening a menu wakes it at once. Reach for it within 5 s of it folding and the quiet time doubles for the session (up to 30 s). Settings › Display › Keep the menu open while playing turns folding off.',
          '',
          '**Where the preset goes on the Rig.** P1 (the default) puts it in the capsule (‹ name ⌄ ›, Perform, Mute; the page labels, Tuner, search and status appear when it opens; the bubble reads "øxidal · name"). P2 (the alternative) puts it at the start of the chain bar, with Tuner and Perform beside Save; the capsule stays pages, search, status and Mute.',
          '',
          '**Motion** (turn on Slow motion to see each four times slower):',
          '- Collapse and expand: the capsule width morphs (a light spring only when popping open), its parts cross-fade with a small scale (0.96 → 1) and blur (4 px → 0), and the wordmark slides between its place and the centre. About 260–300 ms: ease-out opening, ease-in closing.',
          '- Opening: page labels slide in from the left end, Tuner, search and the status word from the right, each 35 ms after the last.',
          '- Edge figures: fading to faint takes 700 ms with a 1 px drift, top to bottom 35 ms apart; waking takes 200 ms. A figure that turns bad brightens and glows once, then holds. The bubble glows once when a problem starts while collapsed.',
          '- Meters: always full strength; the level rises fast and falls slower, the peak holds and then decays.',
          "- The ☰ menu arrives with the design system's arrive motion.",
          '- Reduced motion: plain short fades, no slides, scales, blurs or glows. E-paper: no animation, the capsule stays open.',
        ].join('\n'),
      },
    },
    viewport: {
      options: {
        chainDesktop: {
          name: 'Desktop 1440 × 900',
          styles: { width: '1440px', height: '900px' },
        },
        tabletLandscape: {
          name: 'Tablet, landscape 1024 × 768',
          styles: { width: '1024px', height: '768px' },
        },
        tabletPortrait: {
          name: 'Tablet, portrait 768 × 1024',
          styles: { width: '768px', height: '1024px' },
        },
        iphoneXr: {
          name: 'iPhone XR',
          styles: { width: '414px', height: '896px' },
        },
        foldInnerChain: {
          name: 'Galaxy Z Fold 4, unfolded 673 × 841',
          styles: { width: '673px', height: '841px' },
        },
        iphoneXrLandscape: {
          name: 'iPhone XR, landscape 896 × 414',
          styles: { width: '896px', height: '414px' },
        },
        foldCoverChain: {
          name: 'Galaxy Z Fold 4, folded 374 × 882',
          styles: { width: '374px', height: '882px' },
        },
      },
    },
  },
  argTypes: {
    playing: { control: 'boolean' },
    silent: { control: 'boolean', name: 'Guitar silent' },
    keepMenuOpen: { control: 'boolean', name: 'Keep the menu open' },
    slowMotion: { control: 'boolean', name: 'Slow motion (×4)' },
    variant: { control: 'inline-radio', options: ['p1', 'p2'] },
    idleSeconds: { control: { type: 'range', min: 0.5, max: 10, step: 0.5 } },
  },
};
export default meta;
type Story = StoryObj<typeof C2Sample>;

const at = (value: string) => ({ viewport: { value, isRotated: false } });

/** Playing with a short idle time: wait, watch it squeeze, then move to the top. */
export const Interactive: Story = {
  globals: at('chainDesktop'),
  args: {
    page: 'rig',
    variant: 'p1',
    playing: true,
    idleSeconds: 1.5,
    slowMotion: false,
  },
  render: (args) => <C2Sample {...args} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const header = () =>
      canvasElement.querySelector('[data-slot=floating-capsule]');
    // Mute is reachable while working.
    await expect(page.getByRole('button', { name: /Mute/ })).toBeVisible();
    // Idle: the capsule squeezes into the bubble, Mute still there.
    await waitFor(
      () => expect(header()).toHaveAttribute('data-phase', 'bubble'),
      { timeout: 5000 },
    );
    await waitFor(() =>
      expect(page.getByRole('button', { name: /^Show menu/ })).toBeVisible(),
    );
    await expect(page.getByRole('button', { name: 'Mute' })).toBeVisible();
    // The pointer near the top brings the capsule back.
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 700, clientY: 20 }),
    );
    await waitFor(() =>
      expect(header()).not.toHaveAttribute('data-phase', 'bubble'),
    );
    await expect(page.getByRole('button', { name: /Mute/ })).toBeVisible();
  },
};

export const RigWorking: Story = {
  name: 'Rig · P1 preset in the capsule · working',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="rig" phase="rest" />,
};

export const RigOpen: Story = {
  name: 'Rig · P1 preset in the capsule · capsule open',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="rig" phase="open" />,
};

export const RigSqueezing: Story = {
  name: 'Rig · squeezing (mid-animation)',
  // A frozen frame half-way through the squeeze: half-faded text is the point
  // of the picture, so the contrast check is left to the resting states.
  parameters: { a11y: { test: 'off' } },
  globals: at('chainDesktop'),
  render: () => <C2Sample page="rig" phase="squeezing" />,
};

export const RigPlaying: Story = {
  name: 'Rig · P1 preset in the capsule · playing',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="rig" phase="bubble" />,
};

export const RigBarWorking: Story = {
  name: 'Rig · alternative P2 preset in the chain bar · working',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="rig" variant="p2" phase="rest" />,
};

export const RigBarOpen: Story = {
  name: 'Rig · alternative P2 preset in the chain bar · capsule open',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="rig" variant="p2" phase="open" />,
};

export const RigBarPlaying: Story = {
  name: 'Rig · alternative P2 preset in the chain bar · playing',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="rig" variant="p2" phase="bubble" />,
};

export const RigPhoneBarWorking: Story = {
  name: 'Rig · alternative P2 · iPhone XR · working',
  globals: at('iphoneXr'),
  render: () => <C2Sample page="rig" variant="p2" phase="rest" />,
};

export const RigPhoneBarPlaying: Story = {
  name: 'Rig · alternative P2 · iPhone XR · playing',
  globals: at('iphoneXr'),
  render: () => <C2Sample page="rig" variant="p2" phase="bubble" />,
};

export const RigProblem: Story = {
  name: 'Rig · playing, DSP hot',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="rig" phase="bubble" problem />,
};

export const RigStopped: Story = {
  name: 'Rig · audio stopped',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="rig" stopped phase="rest" />,
};

export const PerformWorking: Story = {
  name: 'Perform · working',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="perform" phase="rest" />,
};

export const PerformPlaying: Story = {
  name: 'Perform · playing',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="perform" phase="bubble" />,
};

export const GuitarsWorking: Story = {
  name: 'Guitars · working',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="guitars" phase="rest" />,
};

export const GuitarsPlaying: Story = {
  name: 'Guitars · playing',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="guitars" phase="bubble" />,
};

export const LibraryWorking: Story = {
  name: 'Library · working',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="library" phase="rest" />,
};

export const LibraryPlaying: Story = {
  name: 'Library · playing',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="library" phase="bubble" />,
};

export const LevelsWorking: Story = {
  name: 'Levels · working',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="levels" phase="rest" />,
};

export const LevelsPlaying: Story = {
  name: 'Levels · playing',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="levels" phase="bubble" />,
};

export const SettingsAudioWorking: Story = {
  name: 'Settings · Audio · working',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="settings-audio" phase="rest" />,
};

export const SettingsAudioPlaying: Story = {
  name: 'Settings · Audio · playing',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="settings-audio" phase="bubble" />,
};

export const SettingsMidiWorking: Story = {
  name: 'Settings · MIDI · working',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="settings-midi" phase="rest" />,
};

export const SettingsMidiPlaying: Story = {
  name: 'Settings · MIDI · playing',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="settings-midi" phase="bubble" />,
};

export const ToolsWorking: Story = {
  name: 'Tools menu over Library',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="tools" phase="open" />,
};

export const RigTabletWorking: Story = {
  name: 'Rig · tablet · working',
  globals: at('tabletLandscape'),
  render: () => <C2Sample page="rig" phase="rest" />,
};

export const RigTabletPlaying: Story = {
  name: 'Rig · tablet · playing',
  globals: at('tabletLandscape'),
  render: () => <C2Sample page="rig" phase="bubble" />,
};

export const RigPhoneWorking: Story = {
  name: 'Rig · P1 · iPhone XR · working',
  globals: at('iphoneXr'),
  render: () => <C2Sample page="rig" phase="rest" />,
};

export const RigPhonePlaying: Story = {
  name: 'Rig · P1 · iPhone XR · playing',
  globals: at('iphoneXr'),
  render: () => <C2Sample page="rig" phase="bubble" />,
};

export const SettingsPhoneWorking: Story = {
  name: 'Settings · iPhone XR · working',
  globals: at('iphoneXr'),
  render: () => <C2Sample page="settings-audio" phase="rest" />,
};

export const SettingsPhonePlaying: Story = {
  name: 'Settings · iPhone XR · playing',
  globals: at('iphoneXr'),
  render: () => <C2Sample page="settings-audio" phase="bubble" />,
};

export const RigFoldPlaying: Story = {
  name: 'Rig · Fold cover · playing',
  globals: at('foldCoverChain'),
  render: () => <C2Sample page="rig" phase="bubble" />,
};

/** E-paper: no animation, solid surfaces, the header stays in its working state. */
export const RigEpaper: Story = {
  name: 'Rig · E-paper',
  globals: at('chainDesktop'),
  render: () => (
    <div className="display-sample" data-display="epaper">
      <C2Sample page="rig" />
    </div>
  ),
};

/** Audio runs but the guitar is silent: the capsule never folds. */
export const RuleSilentGuitar: Story = {
  name: 'Rule · silent guitar keeps it open',
  globals: at('chainDesktop'),
  args: { page: 'rig', playing: true, silent: true, idleSeconds: 1 },
  render: (args) => <C2Sample {...args} />,
  play: async ({ canvasElement }) => {
    const header = canvasElement.querySelector('[data-slot=floating-capsule]');
    await new Promise((r) => setTimeout(r, 4500));
    await expect(header).not.toHaveAttribute('data-phase', 'bubble');
  },
};

/** The ☰ menu is open: the capsule never folds under it. */
export const RuleMenuOpen: Story = {
  name: 'Rule · open menu keeps it open',
  globals: at('chainDesktop'),
  args: { page: 'library', playing: true, idleSeconds: 1 },
  render: (args) => <C2Sample {...args} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const header = canvasElement.querySelector('[data-slot=floating-capsule]');
    await userEvent.click(page.getByRole('button', { name: 'Menu' }));
    await expect(await body.findByRole('menu')).toBeVisible();
    await new Promise((r) => setTimeout(r, 4500));
    await expect(header).not.toHaveAttribute('data-phase', 'bubble');
    await userEvent.keyboard('{Escape}');
  },
};

/** Reaching for it right after it folds doubles the quiet time. */
export const RuleReachAgain: Story = {
  name: 'Rule · reach again doubles the quiet time',
  globals: at('chainDesktop'),
  args: { page: 'rig', playing: true, idleSeconds: 1 },
  render: (args) => <C2Sample {...args} />,
  play: async ({ canvasElement }) => {
    const header = () =>
      canvasElement.querySelector('[data-slot=floating-capsule]');
    await expect(header()).toHaveAttribute('data-idle-ms', '1000');
    await waitFor(
      () => expect(header()).toHaveAttribute('data-phase', 'bubble'),
      { timeout: 6000 },
    );
    await userEvent.keyboard('{Shift}');
    await waitFor(() =>
      expect(header()).toHaveAttribute('data-idle-ms', '2000'),
    );
  },
};

/** Settings › Display: the switch that keeps the menu open while playing. */
export const SettingsDisplayWorking: Story = {
  name: 'Settings · Display · keep the menu open',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="settings-display" phase="rest" />,
};

/** Perform with the ten switches of a MIDI Captain STD 10. */
export const PerformTenSwitches: Story = {
  name: 'Perform · ten switches',
  globals: at('chainDesktop'),
  render: () => <C2PerformSample controller="ten" phase="rest" />,
};

export const PerformTablet: Story = {
  name: 'Perform · tablet',
  globals: at('tabletLandscape'),
  render: () => <C2Sample page="perform" phase="rest" />,
};

export const MobilePerformXr: Story = {
  name: 'Mobile · Perform · iPhone XR',
  globals: at('iphoneXr'),
  render: () => <C2Sample page="perform" phase="rest" />,
};

export const MobileLibraryXr: Story = {
  name: 'Mobile · Library · iPhone XR',
  globals: at('iphoneXr'),
  render: () => <C2Sample page="library" phase="rest" />,
};

export const MobileRigFoldCover: Story = {
  name: 'Mobile · Rig · Fold cover',
  globals: at('foldCoverChain'),
  render: () => <C2Sample page="rig" phase="rest" />,
};

export const MobilePerformFoldCover: Story = {
  name: 'Mobile · Perform · Fold cover',
  globals: at('foldCoverChain'),
  render: () => <C2Sample page="perform" phase="rest" />,
};

export const MobileLibraryFoldCover: Story = {
  name: 'Mobile · Library · Fold cover',
  globals: at('foldCoverChain'),
  render: () => <C2Sample page="library" phase="rest" />,
};

export const MobileSettingsFoldCover: Story = {
  name: 'Mobile · Settings · Fold cover',
  globals: at('foldCoverChain'),
  render: () => <C2Sample page="settings-audio" phase="rest" />,
};

export const MobileRigFoldInner: Story = {
  name: 'Mobile · Rig · Fold inner',
  globals: at('foldInnerChain'),
  render: () => <C2Sample page="rig" phase="rest" />,
};

export const MobilePerformFoldInner: Story = {
  name: 'Mobile · Perform · Fold inner',
  globals: at('foldInnerChain'),
  render: () => <C2Sample page="perform" phase="rest" />,
};

export const MobileLibraryFoldInner: Story = {
  name: 'Mobile · Library · Fold inner',
  globals: at('foldInnerChain'),
  render: () => <C2Sample page="library" phase="rest" />,
};

export const MobileSettingsFoldInner: Story = {
  name: 'Mobile · Settings · Fold inner',
  globals: at('foldInnerChain'),
  render: () => <C2Sample page="settings-audio" phase="rest" />,
};

export const MobileRigLandscape: Story = {
  name: 'Mobile · Rig · iPhone XR landscape',
  globals: at('iphoneXrLandscape'),
  render: () => <C2Sample page="rig" phase="rest" />,
};

export const MobilePerformLandscape: Story = {
  name: 'Mobile · Perform · iPhone XR landscape',
  globals: at('iphoneXrLandscape'),
  render: () => <C2Sample page="perform" phase="rest" />,
};

/** First run under the capsule: one step done, the next one clear. */
export const WelcomeDesktop: Story = {
  name: 'Welcome · desktop',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="welcome" phase="rest" />,
};

export const WelcomeTablet: Story = {
  name: 'Welcome · tablet',
  globals: at('tabletLandscape'),
  render: () => <C2Sample page="welcome" phase="rest" />,
};

export const WelcomeXr: Story = {
  name: 'Welcome · iPhone XR',
  globals: at('iphoneXr'),
  render: () => <C2Sample page="welcome" phase="rest" />,
};

export const WelcomeFoldCover: Story = {
  name: 'Welcome · Fold cover',
  globals: at('foldCoverChain'),
  render: () => <C2Sample page="welcome" phase="rest" />,
};

/** A track plays: the capsule shows it; the dock stays closed. */
export const DockClosed: Story = {
  name: 'Dock · closed, track playing',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="rig" track phase="rest" />,
};

/** The dock floats over the chain's right side on the Player tab. */
export const DockOverlayPlayer: Story = {
  name: 'Dock · over the chain · Player',
  globals: at('chainDesktop'),
  render: () => (
    <C2Sample page="rig" track dock="overlay" dockTab="player" phase="rest" />
  ),
};

/** The dock pinned beside the chain on the Stems tab. */
export const DockPinnedStems: Story = {
  name: 'Dock · pinned · Stems',
  globals: at('chainDesktop'),
  render: () => (
    <C2Sample page="rig" track dock="pinned" dockTab="stems" phase="rest" />
  ),
};

/** The linked chord sheet in the dock. */
export const DockSheet: Story = {
  name: 'Dock · pinned · Sheet',
  globals: at('chainDesktop'),
  render: () => (
    <C2Sample page="rig" track dock="pinned" dockTab="sheet" phase="rest" />
  ),
};

/** Perform with the chord sheet in the middle; the cards shrink to a row. */
export const PerformSheet: Story = {
  name: 'Perform · chord sheet',
  globals: at('chainDesktop'),
  render: () => <C2PerformSample sheet phase="rest" />,
};

export const DockTablet: Story = {
  name: 'Dock · tablet · Player',
  globals: at('tabletLandscape'),
  render: () => (
    <C2Sample page="rig" track dock="overlay" dockTab="player" phase="rest" />
  ),
};

/** Phone: the mini player above the bottom tabs while a track plays. */
export const MiniPlayerXr: Story = {
  name: 'Dock · iPhone XR · mini player',
  globals: at('iphoneXr'),
  render: () => <C2Sample page="rig" track phase="rest" />,
};

export const PhoneSheetPlayer: Story = {
  name: 'Dock · iPhone XR · sheet · Player',
  globals: at('iphoneXr'),
  render: () => (
    <C2Sample page="rig" track phoneSheet dockTab="player" phase="rest" />
  ),
};

export const PhoneSheetStems: Story = {
  name: 'Dock · iPhone XR · sheet · Stems',
  globals: at('iphoneXr'),
  render: () => (
    <C2Sample page="rig" track phoneSheet dockTab="stems" phase="rest" />
  ),
};

export const PhoneSheetSheet: Story = {
  name: 'Dock · iPhone XR · sheet · Sheet',
  globals: at('iphoneXr'),
  render: () => (
    <C2Sample page="rig" track phoneSheet dockTab="sheet" phase="rest" />
  ),
};

export const MiniPlayerFoldCover: Story = {
  name: 'Dock · Fold cover · mini player',
  globals: at('foldCoverChain'),
  render: () => <C2Sample page="rig" track phase="rest" />,
};

/** Sheet and Notes stacked at the left, Stems (a split running) at the right, the Player at the bottom. */
const MULTI = layoutOf(
  { left: ['sheet', 'notes'], right: ['stems'], bottom: ['player'] },
  { left: { split: true } },
);

export const DockMultiDesktop: Story = {
  name: 'Dock zones · desktop · left, right and bottom',
  globals: at('chainDesktop'),
  render: () => <C2Sample page="rig" track layout={MULTI} phase="rest" />,
};

export const DockMultiFolded: Story = {
  name: 'Dock zones · desktop · left folded to its strip',
  globals: at('chainDesktop'),
  render: () => (
    <C2Sample
      page="rig"
      track
      layout={{
        ...MULTI,
        zones: {
          ...MULTI.zones,
          left: { ...MULTI.zones.left, collapsed: true },
        },
      }}
      phase="rest"
    />
  ),
};

export const DockMultiFloating: Story = {
  name: 'Dock zones · desktop · Notes floating',
  globals: at('chainDesktop'),
  render: () => (
    <C2Sample
      page="rig"
      track
      layout={layoutOf(
        { left: ['sheet'], right: ['stems'], bottom: ['player'] },
        {},
        [{ id: 'notes', x: 560, y: 150 }],
      )}
      phase="rest"
    />
  ),
};

export const DockMultiMenu: Story = {
  name: 'Dock zones · desktop · a tool menu open',
  globals: at('chainDesktop'),
  parameters: { a11y: { test: 'off' } },
  render: () => (
    <C2Sample
      page="rig"
      track
      layout={MULTI}
      menuOpenFor="stems"
      phase="rest"
    />
  ),
};

export const DockMultiPerform: Story = {
  name: 'Dock zones · Perform · sheet in the middle, Player at the bottom',
  globals: at('chainDesktop'),
  render: () => <C2PerformSample sheet playerDock phase="rest" />,
};

export const DockMultiTablet: Story = {
  name: 'Dock zones · tablet portrait · one side zone and the bottom',
  globals: at('tabletPortrait'),
  render: () => <C2Sample page="rig" track layout={MULTI} phase="rest" />,
};

export const DockMultiTabletLandscape: Story = {
  name: 'Dock zones · tablet landscape',
  globals: at('tabletLandscape'),
  render: () => <C2Sample page="rig" track layout={MULTI} phase="rest" />,
};

export const DockMultiPhone: Story = {
  name: 'Dock zones · iPhone XR · every tool in one sheet',
  globals: at('iphoneXr'),
  render: () => (
    <C2Sample
      page="rig"
      track
      layout={MULTI}
      phoneSheet
      dockTab="notes"
      phase="rest"
    />
  ),
};

/** Both side zones folded: faint icons beside IN and OUT; the light shows the split still running. */
export const DockBothFolded: Story = {
  name: 'Dock zones · desktop · both sides folded',
  globals: at('chainDesktop'),
  render: () => (
    <C2Sample
      page="rig"
      track
      layout={layoutOf(
        { left: ['sheet', 'notes'], right: ['stems'], bottom: ['player'] },
        { left: { collapsed: true }, right: { collapsed: true } },
      )}
      phase="rest"
    />
  ),
};
