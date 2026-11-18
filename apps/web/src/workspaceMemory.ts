import {
  createContext,
  type Dispatch,
  type SetStateAction,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { leaveScreen } from './lib/leaveGuard';

export const WORKSPACE_LOCATION_EVENT = 'oxidal:workspace-location';
const HISTORY_POSITION = 'oxidalWorkspacePosition';

function historyPosition(): number | null {
  const value: unknown = window.history.state?.[HISTORY_POSITION];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function positionedState(position: number) {
  const state: unknown = window.history.state;
  return {
    ...(state && typeof state === 'object' && !Array.isArray(state)
      ? state
      : {}),
    [HISTORY_POSITION]: position,
  };
}

/** Replace a section or old alias without losing its browser-history identity.
 * @see docs/interface.md
 */
export function replaceWorkspaceLocation(url: URL) {
  window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new Event(WORKSPACE_LOCATION_EVENT));
}

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
    const restore = () => {
      if (locationView() === view) setSection(read());
    };
    window.addEventListener(WORKSPACE_LOCATION_EVENT, restore);
    return () => {
      window.removeEventListener(WORKSPACE_LOCATION_EVENT, restore);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [
    section,
    (next) => {
      const url = new URL(window.location.href);
      url.hash = `${view}/${next}`;
      replaceWorkspaceLocation(url);
      memory?.set(key, next);
      setSection(next);
    },
  ];
}

/** Browser history asks the same leave guard as navigation buttons.
 * @see docs/interface.md
 */
export function useWorkspaceNavigation(): [
  WorkspaceView,
  (view: WorkspaceView) => void,
] {
  const [view, setView] = useState(locationView);
  type Location = { url: string; view: WorkspaceView; position: number };
  const current = useRef<Location>({
    url: window.location.href,
    view,
    position: historyPosition() ?? 0,
  });
  const pending = useRef<{
    target: Location;
    phase: 'return' | 'review' | 'commit';
  } | null>(null);
  const queued = useRef<WorkspaceView | null>(null);

  function navigate(next: WorkspaceView) {
    if (
      pending.current?.phase === 'return' ||
      pending.current?.phase === 'commit'
    ) {
      queued.current = next;
      return;
    }
    pending.current = null;
    if (next === current.current.view) return;
    const url = new URL(window.location.href);
    url.hash = next;
    const position = current.current.position + 1;
    window.history.pushState(positionedState(position), '', url);
    current.current = { url: url.href, view: next, position };
    setView(next);
    window.dispatchEvent(new Event(WORKSPACE_LOCATION_EVENT));
  }

  useEffect(() => {
    // A child may have normalized an old section alias during initial render.
    current.current = {
      ...current.current,
      url: window.location.href,
      view: locationView(),
      position: historyPosition() ?? current.current.position,
    };
    window.history.replaceState(
      positionedState(current.current.position),
      '',
      current.current.url,
    );
    const accepted = () => {
      current.current = {
        url: window.location.href,
        view: locationView(),
        position: historyPosition() ?? current.current.position,
      };
    };
    const publish = (target: Location) => {
      current.current = target;
      pending.current = null;
      setView(target.view);
      window.dispatchEvent(new Event(WORKSPACE_LOCATION_EVENT));
      if (queued.current) {
        const next = queued.current;
        queued.current = null;
        navigate(next);
      }
    };
    const restore = () => {
      let position = historyPosition();
      if (position === null) {
        position = current.current.position + 1;
        window.history.replaceState(
          positionedState(position),
          '',
          window.location.href,
        );
      }
      const target: Location = {
        url: window.location.href,
        view: locationView(),
        position,
      };
      const attempt = pending.current;
      if (
        target.position === current.current.position &&
        target.url === current.current.url
      ) {
        if (attempt?.phase !== 'return') return;
        if (queued.current) {
          const next = queued.current;
          queued.current = null;
          pending.current = null;
          navigate(next);
          return;
        }
        attempt.phase = 'review';
        leaveScreen(() => {
          if (pending.current !== attempt) return;
          attempt.phase = 'commit';
          window.history.go(attempt.target.position - current.current.position);
        });
        return;
      }
      if (
        attempt?.phase === 'commit' &&
        target.position === attempt.target.position &&
        target.url === attempt.target.url
      ) {
        publish(target);
        return;
      }
      if (
        attempt?.phase === 'return' &&
        target.position === attempt.target.position &&
        target.url === attempt.target.url
      )
        return;
      if (target.position === current.current.position) {
        // A same-entry replacement must never cause go(0), which reloads.
        window.history.replaceState(
          positionedState(current.current.position),
          '',
          current.current.url,
        );
        const replacement = { target, phase: 'review' as const };
        pending.current = replacement;
        leaveScreen(() => {
          if (pending.current !== replacement) return;
          window.history.replaceState(
            positionedState(target.position),
            '',
            target.url,
          );
          publish(target);
        });
        return;
      }
      pending.current = { target, phase: 'return' };
      window.history.go(current.current.position - target.position);
    };
    window.addEventListener(WORKSPACE_LOCATION_EVENT, accepted);
    window.addEventListener('popstate', restore);
    window.addEventListener('hashchange', restore);
    return () => {
      pending.current = null;
      window.removeEventListener(WORKSPACE_LOCATION_EVENT, accepted);
      window.removeEventListener('popstate', restore);
      window.removeEventListener('hashchange', restore);
    };
    // All mutable navigation values live in refs; install one browser listener.
  }, []);
  return [view, navigate];
}
