import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type DockLayout, layoutOf } from '../lib/dock-layout';
import { DockSheet, type DockTool, DockZones } from './dock-zones';

const TOOLS: DockTool[] = [
  {
    id: 'player',
    title: 'Player',
    icon: <span>P</span>,
    content: ({ wide }) => <p>Player {wide ? 'across' : 'down'}</p>,
    running: 'Slow Burn is playing',
  },
  { id: 'stems', title: 'Stems', icon: <span>S</span>, content: <p>Mixer</p> },
  { id: 'sheet', title: 'Sheet', icon: <span>C</span>, content: <p>Chords</p> },
  { id: 'notes', title: 'Notes', icon: <span>N</span>, content: <p>Notes</p> },
];

/** A laptop wide and tall enough for both side zones and split zones. */
function wideScreen() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: /min-width|min-height/.test(query),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

function Dock({
  initial,
  onChange,
}: {
  initial: DockLayout;
  onChange?: (layout: DockLayout) => void;
}) {
  const [layout, setLayout] = useState(initial);
  return (
    <DockZones
      tools={TOOLS}
      layout={layout}
      onLayout={(next) => {
        setLayout(next);
        onChange?.(next);
      }}
    >
      {({ bottom }) => (
        <>
          <main>Chain</main>
          {bottom}
        </>
      )}
    </DockZones>
  );
}

beforeEach(wideScreen);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DockZones', () => {
  it('shows each zone with its tools as tabs, the bottom one laid across', () => {
    render(
      <Dock
        initial={layoutOf({
          left: ['sheet', 'notes'],
          right: ['stems'],
          bottom: ['player'],
        })}
      />,
    );
    const left = screen.getByRole('region', { name: 'Left dock' });
    expect(within(left).getByRole('tab', { name: /Sheet/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(left).getByText('Chords')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Bottom dock' })).getByText(
        'Player across',
      ),
    ).toBeInTheDocument();
  });

  it('splits a zone when asked and there is room', () => {
    render(
      <Dock
        initial={layoutOf(
          { left: ['sheet', 'notes'] },
          { left: { split: true } },
        )}
      />,
    );
    const left = screen.getByRole('region', { name: 'Left dock' });
    expect(within(left).getByRole('group', { name: 'Sheet' })).toBeVisible();
    expect(within(left).getByRole('group', { name: 'Notes' })).toBeVisible();
    expect(within(left).queryByRole('tab')).toBeNull();
  });

  it('moves a tool with its menu, by keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Dock
        initial={layoutOf({ right: ['stems', 'notes'] })}
        onChange={onChange}
      />,
    );
    screen.getByRole('button', { name: 'Stems: where to keep it' }).focus();
    await user.keyboard('{Enter}');
    const left = await screen.findByRole('menuitem', { name: /Dock left/ });
    left.focus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        zones: expect.objectContaining({
          left: expect.objectContaining({ tools: ['stems'], active: 'stems' }),
          right: expect.objectContaining({ tools: ['notes'] }),
        }),
      }),
    );
    expect(screen.getByRole('region', { name: 'Left dock' })).toBeVisible();
  });

  it('marks where a tool is now in its menu, and says what carries on', async () => {
    const user = userEvent.setup();
    render(<Dock initial={layoutOf({ bottom: ['player'] })} />);
    await user.click(
      screen.getByRole('button', { name: 'Player: where to keep it' }),
    );
    expect(
      screen.getByRole('menuitem', { name: /Dock bottom/ }),
    ).toHaveAttribute('aria-current', 'true');
    expect(
      screen.getByText(/Slow Burn is playing; it carries on/),
    ).toBeInTheDocument();
  });

  it('folds a zone to faint icons, with a light on running work, and opens it again', async () => {
    const user = userEvent.setup();
    render(<Dock initial={layoutOf({ right: ['stems', 'player'] })} />);
    await user.click(
      screen.getByRole('button', { name: 'Fold the right dock' }),
    );
    expect(screen.queryByRole('region', { name: 'Right dock' })).toBeNull();
    const strip = screen.getByRole('toolbar', { name: 'Right dock, folded' });
    const player = within(strip).getByRole('button', {
      name: 'Open Player. Slow Burn is playing',
    });
    expect(player.querySelector('[data-slot=running-light]')).not.toBeNull();
    await user.click(player);
    const right = screen.getByRole('region', { name: 'Right dock' });
    expect(within(right).getByRole('tab', { name: /Player/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('resizes a zone from its grip with the arrow keys, within limits', () => {
    const onChange = vi.fn();
    render(
      <Dock initial={layoutOf({ left: ['sheet'] })} onChange={onChange} />,
    );
    const grip = screen.getByRole('separator', { name: 'Left dock size' });
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        zones: expect.objectContaining({
          left: expect.objectContaining({ size: 364 }),
        }),
      }),
    );
    for (let i = 0; i < 20; i += 1)
      fireEvent.keyDown(grip, { key: 'ArrowRight' });
    expect(grip).toHaveAttribute('aria-valuenow', '520');
  });

  it('floats a tool on its own and closes it', async () => {
    const user = userEvent.setup();
    render(
      <Dock initial={layoutOf({}, {}, [{ id: 'notes', x: 200, y: 120 }])} />,
    );
    const float = screen.getByRole('region', { name: 'Notes, floating' });
    expect(within(float).getByText('Notes', { selector: 'p' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close Notes' }));
    expect(
      screen.queryByRole('region', { name: 'Notes, floating' }),
    ).toBeNull();
  });

  it('floats glass over the middle when there is room for one side only', () => {
    vi.restoreAllMocks();
    render(<Dock initial={layoutOf({ left: ['sheet'], right: ['stems'] })} />);
    expect(screen.queryByRole('region', { name: 'Left dock' })).toBeNull();
    const right = screen.getByRole('region', { name: 'Right dock' });
    expect(right).toHaveAttribute('data-glass', 'true');
    expect(within(right).getAllByRole('tab')).toHaveLength(2);
  });
});

describe('DockSheet', () => {
  it('shows one tool at a time as tabs', async () => {
    const user = userEvent.setup();
    function Sheet() {
      const [active, setActive] = useState('player');
      return (
        <DockSheet
          tools={TOOLS.slice(0, 2)}
          open
          onOpenChange={() => {}}
          active={active}
          onActive={setActive}
          title="Slow Burn"
        />
      );
    }
    render(<Sheet />);
    expect(screen.getByRole('dialog', { name: 'Slow Burn' })).toBeVisible();
    expect(screen.getByText('Player down')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Stems' }));
    expect(screen.getByText('Mixer')).toBeVisible();
  });
});
