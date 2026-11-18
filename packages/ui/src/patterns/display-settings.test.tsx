import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { DisplaySettings } from './display-settings';

afterEach(cleanup);

it('leaves browser state with its owner and sends only explicit user changes', async () => {
  const mode = vi.fn();
  const status = vi.fn();
  const awake = vi.fn();
  const fullscreen = vi.fn();
  const props = {
    mode: 'epaper',
    onModeChange: mode,
    status: 'detailed' as const,
    onStatusChange: status,
    keepAwake: true,
    onKeepAwakeChange: awake,
    fullscreen: true,
    onToggleFullscreen: fullscreen,
  };
  const view = render(<DisplaySettings {...props} />);
  expect(mode).not.toHaveBeenCalled();
  expect(status).not.toHaveBeenCalled();
  expect(awake).not.toHaveBeenCalled();
  expect(fullscreen).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByRole('radio', { name: 'Night' }));
  expect(mode).toHaveBeenCalledExactlyOnceWith('stage');
  // Until confirmed by the owner, selection still shows the supplied preference.
  expect(screen.getByRole('radio', { name: 'E-paper' })).toBeChecked();
  await user.click(screen.getByRole('radio', { name: 'Simple' }));
  expect(status).toHaveBeenCalledExactlyOnceWith('simple');
  await user.click(screen.getByRole('switch', { name: 'Keep screen awake' }));
  expect(awake).toHaveBeenCalledExactlyOnceWith(false);
  await user.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
  expect(fullscreen).toHaveBeenCalledOnce();
  view.rerender(
    <DisplaySettings
      {...props}
      mode="stage"
      keepAwake={false}
      fullscreen={false}
    />,
  );
  expect(screen.getByRole('radio', { name: 'Night' })).toBeChecked();
  expect(screen.getByRole('switch')).not.toBeChecked();
});

it('reports unsupported or denied browser features without successful fixture state', async () => {
  const retry = vi.fn();
  const props = {
    mode: 'default',
    onModeChange: vi.fn(),
    status: 'simple' as const,
    onStatusChange: vi.fn(),
    keepAwake: true,
    onKeepAwakeChange: vi.fn(),
    wakeStatus: 'denied' as const,
    onRetryWake: retry,
    fullscreen: false,
    onToggleFullscreen: vi.fn(),
    fullscreenError: 'Fullscreen was not allowed by this browser.',
  };
  const view = render(
    <DisplaySettings
      {...props}
      wakeSupported={false}
      fullscreenSupported={false}
    />,
  );
  expect(screen.getByRole('switch')).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Enter fullscreen' }),
  ).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Keep-awake unavailable',
  );
  expect(screen.getByRole('alert')).toHaveTextContent(props.fullscreenError);
  expect(
    screen.queryByRole('button', { name: 'Retry keep-awake' }),
  ).not.toBeInTheDocument();
  view.rerender(<DisplaySettings {...props} wakeSupported />);
  expect(screen.getByRole('status')).toHaveTextContent('not allowed');
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Retry keep-awake' }));
  expect(retry).toHaveBeenCalledOnce();
});
