import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { setLeaveGuard } from './lib/leaveGuard';
import {
  replaceWorkspaceLocation,
  useSectionLocation,
  useWorkspaceNavigation,
  useWorkspaceState,
  WorkspaceMemory,
} from './workspaceMemory';
let releaseGuard: (() => void) | undefined;
afterEach(() => {
  releaseGuard?.();
  releaseGuard = undefined;
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

function HistoryNavigation() {
  const [view, navigate] = useWorkspaceNavigation();
  const [section, select] = useSectionLocation(
    'settings',
    ['audio', 'device'],
    'audio',
  );
  return (
    <>
      <output aria-label="Workspace">{view}</output>
      <output aria-label="Section">{section}</output>
      <button onClick={() => navigate('rig')}>Rig</button>
      <button onClick={() => navigate('settings')}>Settings</button>
      <button onClick={() => navigate('library')}>Library</button>
      <button onClick={() => select('device')}>Device</button>
    </>
  );
}

it('keeps a guarded Back on the same entry and ignores an older leave decision', async () => {
  window.history.replaceState(
    { other: 'preserved' },
    '',
    '/?development=simulator#rig',
  );
  render(<HistoryNavigation />);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Device' }));
  const decisions: (() => void)[] = [];
  const guard = vi.fn((go: () => void) => {
    decisions.push(go);
    return true;
  });
  releaseGuard = setLeaveGuard(guard);
  window.history.back();
  await waitFor(() => expect(guard).toHaveBeenCalledTimes(1));
  expect(window.location.hash).toBe('#settings/device');
  expect(screen.getByLabelText('Workspace')).toHaveTextContent('settings');
  expect(screen.getByLabelText('Section')).toHaveTextContent('device');
  expect(window.history.state.other).toBe('preserved');
  // Cancel by continuing to edit, then make another attempt.
  window.history.back();
  await waitFor(() => expect(guard).toHaveBeenCalledTimes(2));
  act(() => decisions[0]!());
  expect(window.location.hash).toBe('#settings/device');
  act(() => decisions[1]!());
  await waitFor(() =>
    expect(screen.getByLabelText('Workspace')).toHaveTextContent('rig'),
  );
  expect(window.location.search).toBe('?development=simulator');
  releaseGuard();
  window.history.forward();
  await waitFor(() =>
    expect(screen.getByLabelText('Workspace')).toHaveTextContent('settings'),
  );
  expect(window.location.hash).toBe('#settings/device');
});

it('does not replace a guarded section before a manual hash change is accepted', async () => {
  window.history.replaceState(null, '', '/#settings/audio');
  render(<HistoryNavigation />);
  let proceed!: () => void;
  const guard = vi.fn((go: () => void) => {
    proceed = go;
    return true;
  });
  releaseGuard = setLeaveGuard(guard);
  window.location.hash = 'settings/device';
  await waitFor(() => expect(guard).toHaveBeenCalledTimes(1));
  expect(window.location.hash).toBe('#settings/audio');
  expect(screen.getByLabelText('Section')).toHaveTextContent('audio');
  act(() => proceed());
  await waitFor(() =>
    expect(screen.getByLabelText('Section')).toHaveTextContent('device'),
  );
  expect(window.location.hash).toBe('#settings/device');
});

it('preserves an initially normalized alias and section history identity', async () => {
  window.history.replaceState({ other: 'preserved' }, '', '/#library/sounds');
  function Alias() {
    const [view, navigate] = useWorkspaceNavigation();
    if (window.location.hash === '#library/sounds') {
      const url = new URL(window.location.href);
      url.hash = 'library/tones';
      replaceWorkspaceLocation(url);
    }
    return (
      <>
        <output aria-label="Workspace">{view}</output>
        <button onClick={() => navigate('rig')}>Rig</button>
      </>
    );
  }
  render(<Alias />);
  expect(window.location.hash).toBe('#library/tones');
  fireEvent.click(screen.getByRole('button', { name: 'Rig' }));
  window.history.back();
  await waitFor(() =>
    expect(screen.getByLabelText('Workspace')).toHaveTextContent('library'),
  );
  expect(window.location.hash).toBe('#library/tones');
  expect(window.history.state.other).toBe('preserved');
});

it('guards a same-entry replacement without reloading the page', async () => {
  window.history.replaceState(null, '', '/#rig');
  render(<HistoryNavigation />);
  let proceed!: () => void;
  releaseGuard = setLeaveGuard((go) => {
    proceed = go;
    return true;
  });
  const go = vi.spyOn(window.history, 'go');
  act(() => {
    window.history.replaceState(window.history.state, '', '/#library');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(window.location.hash).toBe('#rig');
  act(() => proceed());
  expect(screen.getByLabelText('Workspace')).toHaveTextContent('library');
  expect(go).not.toHaveBeenCalled();
});

it('serializes a button navigation arriving while Back is being restored', async () => {
  window.history.replaceState(null, '', '/#rig');
  render(<HistoryNavigation />);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  const duringBack = () => {
    if (window.location.hash !== '#rig') return;
    window.removeEventListener('popstate', duringBack);
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
  };
  window.addEventListener('popstate', duringBack);
  try {
    window.history.back();
    await waitFor(() =>
      expect(screen.getByLabelText('Workspace')).toHaveTextContent('library'),
    );
    expect(window.location.hash).toBe('#library');
  } finally {
    window.removeEventListener('popstate', duringBack);
  }
});
function Search() {
  const [query, setQuery] = useWorkspaceState('query', '');
  return (
    <input
      aria-label="Search sounds"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
    />
  );
}
it('retains browsing context through unmount without leaking into another application instance', () => {
  const memory = new Map<string, unknown>();
  const page = render(
    <WorkspaceMemory.Provider value={memory}>
      <Search />
    </WorkspaceMemory.Provider>,
  );
  fireEvent.change(screen.getByLabelText('Search sounds'), {
    target: { value: 'Bogner' },
  });
  page.rerender(
    <WorkspaceMemory.Provider value={memory}>
      <p>Rig</p>
    </WorkspaceMemory.Provider>,
  );
  page.rerender(
    <WorkspaceMemory.Provider value={memory}>
      <Search />
    </WorkspaceMemory.Provider>,
  );
  expect(screen.getByLabelText('Search sounds')).toHaveValue('Bogner');
  page.unmount();
  render(
    <WorkspaceMemory.Provider value={new Map()}>
      <Search />
    </WorkspaceMemory.Provider>,
  );
  expect(screen.getByLabelText('Search sounds')).toHaveValue('');
});
it('returns to the previous workspace through browser Back while retaining unrelated URL parameters', async () => {
  window.history.replaceState(null, '', '/?development=simulator#rig');
  function Navigation() {
    const [view, navigate] = useWorkspaceNavigation();
    return (
      <>
        <output>{view}</output>
        <button onClick={() => navigate('library')}>Library</button>
      </>
    );
  }
  render(<Navigation />);
  fireEvent.click(screen.getByRole('button', { name: 'Library' }));
  expect(window.location.hash).toBe('#library');
  expect(window.location.search).toBe('?development=simulator');
  window.history.back();
  await waitFor(() => expect(screen.getByText('rig')).toBeVisible());
});
