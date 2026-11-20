import { FileText } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useState } from 'react';

import {
  ToolDock,
  type ToolPlaces,
  type ToolPosition,
} from '@oxidal/design-system/patterns/tool-dock';

import { LinkedSheet, LinkedSheetProvider } from './LinkedSheet';

const STORAGE_KEY = 'oxidal.tools.v2';
type Preferences = {
  last: ToolPlaces;
  positions: Record<string, ToolPosition>;
};
function readPreferences(): Preferences {
  const result: Preferences = { last: {}, positions: {} };
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? 'null',
    );
    if (!parsed || typeof parsed !== 'object') return result;
    if (
      'last' in parsed &&
      parsed.last &&
      typeof parsed.last === 'object' &&
      'chords' in parsed.last &&
      ['sheet', 'float', 'left', 'right'].includes(String(parsed.last.chords))
    ) {
      result.last.chords = parsed.last.chords as ToolPlaces[string];
    }
    if (
      'positions' in parsed &&
      parsed.positions &&
      typeof parsed.positions === 'object' &&
      'chords' in parsed.positions &&
      parsed.positions.chords &&
      typeof parsed.positions.chords === 'object'
    ) {
      const spot = parsed.positions.chords;
      if (
        'x' in spot &&
        'y' in spot &&
        typeof spot.x === 'number' &&
        typeof spot.y === 'number' &&
        Number.isFinite(spot.x) &&
        Number.isFinite(spot.y) &&
        Math.abs(spot.x) <= 100000 &&
        Math.abs(spot.y) <= 100000
      ) {
        const width =
          'width' in spot &&
          typeof spot.width === 'number' &&
          Number.isFinite(spot.width)
            ? Math.max(256, Math.min(4096, spot.width))
            : undefined;
        const height =
          'height' in spot &&
          typeof spot.height === 'number' &&
          Number.isFinite(spot.height)
            ? Math.max(160, Math.min(4096, spot.height))
            : undefined;
        result.positions.chords = { x: spot.x, y: spot.y, width, height };
      }
    }
  } catch {
    /* Optional viewer preferences. */
  }
  return result;
}

/** Presentation only: moving a tool does not send a player or rig command. */
export function PerformanceTools({
  connected,
  children,
}: {
  connected: boolean;
  children: ReactNode;
}) {
  const [places, setPlaces] = useState<ToolPlaces>({});
  const [preferences, setPreferences] = useState(readPreferences);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      /* Keep the session usable. */
    }
  }, [preferences]);
  return (
    <LinkedSheetProvider connected={connected}>
      <ToolDock
        tools={[
          {
            id: 'chords',
            title: 'Chord sheet',
            icon: <FileText />,
            render: () => <LinkedSheet />,
          },
        ]}
        places={places}
        lastPlaces={preferences.last}
        positions={preferences.positions}
        onPositions={(positions) =>
          setPreferences((old) => ({ ...old, positions }))
        }
        onPlaces={(next) => {
          setPlaces(next);
          setPreferences((old) => {
            const last = { ...old.last };
            for (const [id, place] of Object.entries(next))
              if (place !== 'closed') last[id] = place;
            return { ...old, last };
          });
        }}
      >
        {children}
      </ToolDock>
    </LinkedSheetProvider>
  );
}
