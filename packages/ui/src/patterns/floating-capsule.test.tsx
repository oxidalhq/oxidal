import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FloatingCapsule } from './floating-capsule';

afterEach(cleanup);

function capsule(more: Partial<Parameters<typeof FloatingCapsule>[0]> = {}) {
  return (
    <FloatingCapsule
      destination="library"
      onNavigate={() => {}}
      status={{ word: 'All good' }}
      muted={false}
      onMute={() => {}}
      onSearch={() => {}}
      menu={[]}
      playing={false}
      {...more}
    />
  );
}

describe('FloatingCapsule', () => {
  it('builds its ☰ menu from the items it is given, in groups', async () => {
    const user = userEvent.setup();
    const restart = vi.fn();
    const shutDown = vi.fn();
    render(
      capsule({
        menu: [
          [{ id: 'tools', label: 'Tools', onSelect: () => {} }],
          [
            { id: 'restart-audio', label: 'Restart audio', onSelect: restart },
            {
              id: 'shut-down',
              label: 'Shut down device',
              onSelect: shutDown,
              destructive: true,
            },
          ],
        ],
        menuNote: '48 kHz · 128 × 3',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      ' Tools',
      ' Restart audio',
      ' Shut down device',
    ]);
    expect(screen.getAllByRole('separator').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('menuitem', { name: 'Restart audio' }));
    expect(restart).toHaveBeenCalled();
  });

  it('marks the page you are on and goes to another', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(capsule({ onNavigate }));
    expect(screen.getByRole('button', { name: 'Library' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.click(
      screen.getByRole('button', { name: 'Levels', hidden: true }),
    );
    expect(onNavigate).toHaveBeenCalledWith('levels');
  });

  it('keeps Mute and the now-playing part working', async () => {
    const user = userEvent.setup();
    const onMute = vi.fn();
    const onOpen = vi.fn();
    render(
      capsule({
        onMute,
        media: {
          title: 'Slow Burn',
          playing: true,
          position: '1:12',
          work: 'Splitting 64%',
          onOpen,
        },
      }),
    );
    await user.click(screen.getByRole('button', { name: /Mute/ }));
    expect(onMute).toHaveBeenCalledWith(true);
    await user.click(
      screen.getByRole('button', { name: /Slow Burn.*1:12.*Splitting 64%/ }),
    );
    expect(onOpen).toHaveBeenCalled();
  });

  it('holds a phase for a picture of it', () => {
    const { container } = render(capsule({ phase: 'bubble', playing: true }));
    expect(
      container.querySelector('[data-slot=floating-capsule]'),
    ).toHaveAttribute('data-phase', 'bubble');
    expect(
      screen.getByRole('button', { name: /Show menu/ }),
    ).toBeInTheDocument();
  });
});
