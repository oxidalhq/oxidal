import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { About } from './About';
import { capabilities } from './api';

vi.mock('./api', () => ({ capabilities: vi.fn() }));
beforeEach(() => {
  vi.mocked(capabilities).mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('presents Oxidal as a multi-effects amp modeler with its features, licence, build method and author', () => {
  render(<About />);
  expect(
    screen.getByRole('heading', { name: 'About Oxidal' }),
  ).toBeInTheDocument();
  expect(
    screen.getByText('Multi-effects amp modeler · guitar and bass'),
  ).toBeVisible();
  expect(screen.getByText('Backing tracks and stems')).toBeVisible();
  expect(
    screen.getByText(/Open source under the Apache License 2.0/),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: /Source code/ })).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Apache License 2.0' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/oxidalhq/oxidal/blob/main/LICENSE',
  );
  for (const link of screen.getAllByRole('link', { name: /AgenticFlowX/ }))
    expect(link).toHaveAttribute('href', 'https://github.com/AgenticFlowX/afx');
  expect(screen.getByRole('link', { name: 'Built with Rust' })).toHaveAttribute(
    'href',
    'https://www.rust-lang.org',
  );
  expect(
    screen.getByRole('link', { name: 'Powered by TONE3000' }),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: 'Powered by NAM' })).toBeVisible();
  expect(screen.getByText('Bloom')).toBeVisible();
  expect(screen.getByText(/A port of the TONE3000 pitch engine/)).toBeVisible();
  expect(screen.getByText(/spec-driven development/)).toBeVisible();
  expect(screen.getByText('Richard Sentino')).toBeVisible();
  expect(screen.getByText(/Created and developed by/)).toBeVisible();
});

it('uses device readback rather than the approved story example values', async () => {
  vi.mocked(capabilities).mockResolvedValue({
    protocol: 1,
    version: 'device-test-version',
    audio_available: false,
    native_editor: false,
    midi_transport: 'USB only',
  });
  render(<About />);
  expect(await screen.findByText('device-test-version')).toBeVisible();
  expect(screen.getByText('Not available')).toBeVisible();
  expect(screen.getByText('Not installed')).toBeVisible();
  expect(screen.getByText('USB only')).toBeVisible();
  expect(screen.queryByText('Bluetooth and USB')).not.toBeInTheDocument();
});

it('keeps failed device readings visibly unavailable while retaining credits', async () => {
  vi.mocked(capabilities).mockRejectedValue(new Error('offline'));
  render(<About />);
  expect(await screen.findAllByText('Unavailable')).toHaveLength(4);
  expect(screen.getByRole('link', { name: 'Powered by NAM' })).toBeVisible();
  expect(screen.queryByText('Installed')).not.toBeInTheDocument();
});
