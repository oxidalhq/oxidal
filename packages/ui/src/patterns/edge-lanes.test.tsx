import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EdgeLanes } from './edge-lanes';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const lanes = (more: Partial<Parameters<typeof EdgeLanes>[0]> = {}) => (
  <EdgeLanes
    figuresFrom={0}
    input={{
      level: -20,
      peak: -12,
      control: <button type="button">IN Telecaster</button>,
      figures: [
        { label: 'Input', value: '−12 dBFS' },
        { label: 'Calibration', value: 'Not set', attention: true },
      ],
    }}
    output={{
      level: -10,
      peak: -6,
      control: <button type="button">OUT −6.0 dB</button>,
      figures: [{ label: 'DSP', value: '31%' }],
    }}
    {...more}
  />
);

describe('EdgeLanes', () => {
  it('puts the IN lane on the left and the OUT lane on the right, with their controls', () => {
    const { container } = render(lanes());
    const left = container.querySelector('[data-side=left]')!;
    const right = container.querySelector('[data-side=right]')!;
    expect(left).toHaveTextContent('IN Telecaster');
    expect(right).toHaveTextContent('OUT −6.0 dB');
    expect(screen.getByRole('meter', { name: 'In' })).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Out' })).toBeInTheDocument();
  });

  it('says each figure in words, and which need attention', () => {
    render(lanes());
    const input = screen.getByRole('group', { name: 'Input' });
    expect(input).toHaveTextContent('Input −12 dBFS');
    expect(input).toHaveTextContent('Calibration Not set, needs attention');
    expect(
      screen.getByRole('group', { name: 'Processing and output' }),
    ).toHaveTextContent('DSP 31%');
  });

  it('makes a figure with an action a button', async () => {
    const onOpen = vi.fn();
    render(
      lanes({
        input: {
          level: null,
          figures: [
            {
              label: 'MIDI',
              value: 'Chocolate',
              light: 'on',
              title: 'Open Settings › MIDI',
              onOpen,
            },
          ],
        },
      }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'MIDI Chocolate' }),
    );
    expect(onOpen).toHaveBeenCalled();
  });

  it('leaves the figures out when the lanes are too narrow, keeping meters and controls', () => {
    // jsdom lays nothing out: the lanes measure 0 px wide.
    render(lanes({ figuresFrom: 1200 }));
    expect(screen.queryByRole('group', { name: 'Input' })).toBeNull();
    expect(screen.getByRole('meter', { name: 'In' })).toBeInTheDocument();
    expect(screen.getByText('IN Telecaster')).toBeInTheDocument();
  });

  it('rests the meters at 60 % until a signal comes through, then eases back', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      lanes({ input: { level: null }, output: { level: null } }),
    );
    const lane = () =>
      container.querySelector('[data-side=left] [data-slot=meter]')!
        .parentElement!;
    act(() => vi.advanceTimersByTime(300));
    expect(lane()).toHaveClass('opacity-60');
    rerender(lanes({ input: { level: -20 }, output: { level: null } }));
    act(() => vi.advanceTimersByTime(300));
    expect(lane()).toHaveClass('opacity-100');
    rerender(lanes({ input: { level: -70 }, output: { level: null } }));
    act(() => vi.advanceTimersByTime(3500));
    expect(lane()).toHaveClass('opacity-60');
  });

  it('shows "Audio stopped" in place of the meters when audio stops', () => {
    render(lanes({ stopped: true }));
    expect(screen.queryByRole('meter', { name: 'In' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Input' })).toBeNull();
  });
});
