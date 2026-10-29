import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

export const WorkspaceMemory = createContext<Map<string, unknown> | null>(null);

export function useWorkspaceState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const memory = useContext(WorkspaceMemory);
  const [value, setValue] = useState<T>(() =>
    memory?.has(key) ? (memory.get(key) as T) : initial,
  );
  function update(next: SetStateAction<T>) {
    setValue((previous) => {
      const resolved =
        typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
      memory?.set(key, resolved);
      return resolved;
    });
  }
  return [value, update];
}

export type WorkspaceView = 'rig' | 'library' | 'monitor' | 'settings';
const views: WorkspaceView[] = ['rig', 'library', 'monitor', 'settings'];
function locationView(): WorkspaceView {
  const value = window.location.hash.slice(1) as WorkspaceView;
  return views.includes(value) ? value : 'rig';
}

/** Browser history represents workspaces; it never replays an audio command. */
export function useWorkspaceNavigation(): [
  WorkspaceView,
  (view: WorkspaceView) => void,
] {
  const [view, setView] = useState(locationView);
  useEffect(() => {
    const restore = () => setView(locationView());
    window.addEventListener('popstate', restore);
    window.addEventListener('hashchange', restore);
    return () => {
      window.removeEventListener('popstate', restore);
      window.removeEventListener('hashchange', restore);
    };
  }, []);
  return [
    view,
    (next) => {
      if (next !== view) {
        const url = new URL(window.location.href);
        url.hash = next;
        window.history.pushState(null, '', url);
        setView(next);
      }
    },
  ];
}
