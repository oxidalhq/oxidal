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

export type WorkspaceView =
  'rig' | 'guitars' | 'library' | 'monitor' | 'settings';
const views: WorkspaceView[] = [
  'rig',
  'guitars',
  'library',
  'monitor',
  'settings',
];
/** Old and new names for the same workspace; `#monitor` stays a valid link. */
const aliases: Record<string, WorkspaceView> = { levels: 'monitor' };
function locationView(): WorkspaceView {
  const [first = ''] = window.location.hash.slice(1).split('/');
  const value = (aliases[first] ?? first) as WorkspaceView;
  return views.includes(value) ? value : 'rig';
}

/** The section after the workspace, as in `#library/sounds`. */
function locationSection(): string {
  return window.location.hash.slice(1).split('/')[1] ?? '';
}

/**
 * A workspace section that survives refresh and Back. Changing it replaces the
 * history entry, so Back leaves the workspace instead of stepping sections.
 */
export function useSectionLocation<T extends string>(
  view: WorkspaceView,
  sections: readonly T[],
  initial: T,
): [T, (section: T) => void] {
  const memory = useContext(WorkspaceMemory);
  const key = `${view}-section`;
  // The link wins; otherwise return to the section last used in this session.
  const read = () => {
    const found = locationSection() as T;
    if (sections.includes(found)) return found;
    const remembered = memory?.get(key) as T | undefined;
    return remembered && sections.includes(remembered) ? remembered : initial;
  };
  const [section, setSection] = useState<T>(read);
  useEffect(() => {
    const restore = () => setSection(read());
    window.addEventListener('hashchange', restore);
    window.addEventListener('popstate', restore);
    return () => {
      window.removeEventListener('hashchange', restore);
      window.removeEventListener('popstate', restore);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [
    section,
    (next) => {
      const url = new URL(window.location.href);
      url.hash = `${view}/${next}`;
      window.history.replaceState(null, '', url);
      memory?.set(key, next);
      setSection(next);
    },
  ];
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
