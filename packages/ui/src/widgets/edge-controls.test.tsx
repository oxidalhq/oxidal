import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { GuitarSelector } from './guitar-selector';
import { MiniPlayer } from './mini-player';
import { OutputLevelControl } from './output-level-control';
import { StreamStatus } from './stream-status';

beforeAll(() => {
  // jsdom has no ResizeObserver; the level slider measures its thumb with one.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const GUITARS = [
  { id: 'tele', name: 'Telecaster', trim_db: -6 },
  { id: 'lp', name: 'Les Paul', trim_db: -9 },
  { id: 'strat', name: 'Stratocaster', trim_db: 1.5 },
];

describe('GuitarSelector', () => {
  it('shows the guitar plugged in with its trim, and changes it', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onManage = vi.fn();
    render(
      <GuitarSelector
        guitars={GUITARS}
        active="tele"
        onSelect={onSelect}
        onManage={onManage}
      />,
    );
    const trigger = screen.getByRole('button', {
      name: /Telecaster.*−6 dB.*Choose the guitar/,
    });
    await user.click(trigger);
    expect(
      screen.getByRole('menuitem', { name: /Stratocaster.*Trim \+1\.5 dB/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Plugged in')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /Les Paul/ }));
    expect(onSelect).toHaveBeenCalledWith('lp');
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Set up guitars…' }));
    expect(onManage).toHaveBeenCalled();
  });

  it('says when no guitar is chosen', () => {
    render(<GuitarSelector guitars={[]} active={null} onSelect={() => {}} />);
    expect(
      screen.getByRole('button', { name: /No guitar chosen/ }),
    ).toBeInTheDocument();
  });
});

describe('OutputLevelControl', () => {
  it('shows the level and opens Level, Mono and the boost slot', async () => {
    const user = userEvent.setup();
    const onLevel = vi.fn();
    const onMono = vi.fn();
    render(
      <OutputLevelControl
        levelDb={-6}
        onLevel={onLevel}
        mono={false}
        onMono={onMono}
        boost={<button type="button">Boost +0.0 dB</button>}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: /Out.*−6\.0 dB.*Change/ }),
    );
    const level = screen.getByRole('slider', { name: 'Level' });
    expect(level).toHaveAttribute('aria-valuetext', '−6.0 dB');
    fireEvent.keyDown(level, { key: 'ArrowRight' });
    expect(onLevel).toHaveBeenCalledWith(-5.5);
    await user.click(screen.getByRole('button', { name: 'Mono' }));
    expect(onMono).toHaveBeenCalledWith(true);
    expect(
      screen.getByRole('button', { name: 'Boost +0.0 dB' }),
    ).toBeInTheDocument();
  });

  it('says Silent at the bottom and shows a refused change', async () => {
    const user = userEvent.setup();
    render(
      <OutputLevelControl
        levelDb={-60}
        onLevel={() => {}}
        mono
        onMono={() => {}}
        error="The unit did not take the new level."
      />,
    );
    const trigger = screen.getByRole('button', { name: /Silent.*Mono/ });
    await user.click(trigger);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The unit did not take the new level.',
    );
  });
});

describe('StreamStatus', () => {
  const stream = { sample_rate: 48000, period_frames: 128, periods: 3 };

  it('says the stream and engine in one line, with the buffer time worked out', () => {
    render(
      <StreamStatus
        stream={stream}
        engine={{ label: 'NAM Full A2 · 2×', details: [] }}
        fit="full"
      />,
    );
    expect(
      screen.getByRole('button', {
        name: 'Stream and engine: 48 kHz · 128 × 3 · 8.0 ms · NAM Full A2 · 2×',
      }),
    ).toBeInTheDocument();
  });

  it('opens the details with Restart audio and the settings links', async () => {
    const user = userEvent.setup();
    const onRestartAudio = vi.fn();
    const onEngineSettings = vi.fn();
    render(
      <StreamStatus
        stream={{ sample_rate: 44100, period_frames: 256, periods: 2 }}
        engine={{
          label: 'NAM Full A2',
          details: [{ label: 'Oversampling', value: '2×' }],
        }}
        onRestartAudio={onRestartAudio}
        onAudioSettings={() => {}}
        onEngineSettings={onEngineSettings}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Stream and engine/ }));
    expect(screen.getByText('44.1 kHz', { selector: 'dd' })).toBeVisible();
    expect(screen.getByText('11.6 ms', { selector: 'dd' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Restart audio' }));
    expect(onRestartAudio).toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Settings › NAM engine' }),
    );
    expect(onEngineSettings).toHaveBeenCalled();
  });

  it('leaves the engine out when it is not reported', async () => {
    const user = userEvent.setup();
    render(<StreamStatus stream={stream} fit="full" />);
    await user.click(
      screen.getByRole('button', {
        name: 'Stream and engine: 48 kHz · 128 × 3 · 8.0 ms',
      }),
    );
    expect(screen.queryByText('NAM engine')).toBeNull();
  });
});

describe('MiniPlayer', () => {
  it('plays, pauses and opens the player', async () => {
    const user = userEvent.setup();
    const onPause = vi.fn();
    const onOpen = vi.fn();
    render(
      <MiniPlayer
        title="Slow Burn"
        position="1:12"
        duration="3:42"
        progress={0.3}
        playing
        onPlay={() => {}}
        onPause={onPause}
        onOpen={onOpen}
        note="Splitting 64%"
      />,
    );
    const strip = screen.getByRole('group', { name: 'Now playing' });
    expect(strip).toHaveTextContent('1:12 / 3:42 · Splitting 64%');
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onPause).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Slow Burn/ }));
    expect(onOpen).toHaveBeenCalled();
  });
});
