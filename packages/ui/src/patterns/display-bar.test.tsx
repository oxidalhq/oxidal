import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { Button } from '../components/ui/button';
import { AppShell } from './app-shell';
import { RigHeading } from './rig-heading';

const readings = {
  dsp: { p95: 0.2, peak: 0.51 },
  cpu: 31,
  ram: { used: 512, total: 8192 },
  xruns: 0,
  clips: 0,
  temperature: 60,
};
const levels = {
  input: [-18, -20] as [number, number],
  output: [-6, -2] as [number, number],
};

/** A wide screen: the shell shows the display bar. */
function wide(matches: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => wide(true));
afterEach(cleanup);

function shell(extra: Partial<React.ComponentProps<typeof AppShell>> = {}) {
  const onNavigate = vi.fn();
  render(
    <AppShell
      destination="rig"
      onNavigate={onNavigate}
      nowPlaying="Harmonic Tremolo"
      readings={readings}
      bar="display"
      tempo={{ bpm: 112, source: 'the preset' }}
      levels={levels}
      {...extra}
    >
      <RigHeading playing identity={<span>Harmonic Tremolo ▾</span>}>
        <Button>Perform</Button>
        <Button variant="outline">Save</Button>
      </RigHeading>
    </AppShell>,
  );
  return onNavigate;
}

it('puts the five destinations behind one menu button', async () => {
  const user = userEvent.setup();
  const onNavigate = shell();
  const bar = document.querySelector(
    '[data-slot="display-bar"]',
  ) as HTMLElement;
  // The phone bottom bar is hidden by CSS on a wide screen; the bar itself has no destination buttons.
  expect(within(bar).queryByRole('button', { name: 'Library' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Menu' }));
  const nav = within(screen.getByRole('dialog')).getByRole('navigation', {
    name: 'Instrument navigation',
  });
  for (const name of ['Rig', 'Guitars', 'Library', 'Levels', 'Settings'])
    expect(
      within(nav).getByRole('button', { name: new RegExp(name) }),
    ).toBeVisible();
  expect(within(nav).getByRole('button', { name: /Rig/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await user.click(within(nav).getByRole('button', { name: /Library/ }));
  expect(onNavigate).toHaveBeenCalledWith('library');
});

it('shows tempo, input and output peaks and processing load while live', () => {
  shell();
  expect(screen.getByText('112 BPM')).toBeInTheDocument();
  expect(
    screen.getByRole('img', { name: /IN peak: left -18 dB, right -20 dB/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('img', { name: /OUT peak: left -6 dB, right -2 dB/ }),
  ).toBeInTheDocument();
  expect(screen.getByText('DSP')).toBeInTheDocument();
  expect(screen.getByText('20%')).toBeInTheDocument();
  expect(screen.getByText('31%')).toBeInTheDocument();
});

it('leaves out readings that mean nothing when audio is stopped', () => {
  shell({ resourceState: 'stopped' });
  expect(screen.queryByText('112 BPM')).toBeNull();
  expect(screen.queryByRole('img', { name: /peak/ })).toBeNull();
  expect(screen.getByText(/Audio stopped/)).toBeInTheDocument();
});

it('draws the screen heading’s preset and buttons inside the bar', () => {
  shell();
  const bar = document.querySelector(
    '[data-slot="display-bar"]',
  ) as HTMLElement;
  expect(within(bar).getByText('Harmonic Tremolo ▾')).toBeVisible();
  expect(within(bar).getByRole('button', { name: 'Perform' })).toBeVisible();
  expect(within(bar).getByRole('button', { name: 'Save' })).toBeVisible();
  expect(document.querySelector('[data-slot="rig-heading"]')).toBeNull();
});

it('keeps the classic masthead and page heading on a narrow screen', () => {
  wide(false);
  shell();
  expect(document.querySelector('[data-slot="display-bar"]')).toBeNull();
  expect(
    screen.getAllByRole('button', { name: 'Library' }).length,
  ).toBeGreaterThan(0);
  expect(document.querySelector('[data-slot="rig-heading"]')).not.toBeNull();
});

it('keeps the classic look unless the display bar is asked for', () => {
  shell({ bar: 'classic' });
  expect(document.querySelector('[data-slot="display-bar"]')).toBeNull();
});
