import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import {
  WorkspaceMemory,
  useWorkspaceState,
  useWorkspaceNavigation,
} from './workspaceMemory';
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
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
