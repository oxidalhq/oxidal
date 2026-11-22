import {
  FileText,
  MusicNote,
  SlidersHorizontal,
  Waveform,
} from '@phosphor-icons/react';
import { type ReactNode, useEffect, useState } from 'react';

import {
  ToolDock,
  type ToolPlaces,
  type ToolPosition,
} from '@oxidal/design-system/patterns/tool-dock';

import { BackingTool } from '../../components/media/BackingTool';
import { VenueEq, VenueProvider } from '../../components/media/VenueEq';
import { TunerProvider, TunerTool } from '../../GlobalTuner';
import { requestTuner } from '../../tunerNavigation';
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
    for (const id of ['chords', 'backing', 'venue', 'tuner']) {
      if (
        'last' in parsed &&
        parsed.last &&
        typeof parsed.last === 'object' &&
        id in parsed.last &&
        ['sheet', 'float', 'left', 'right'].includes(
          String((parsed.last as Record<string, unknown>)[id]),
        )
      ) {
        result.last[id] = (parsed.last as Record<string, unknown>)[
          id
        ] as ToolPlaces[string];
      }
      if (
        'positions' in parsed &&
        parsed.positions &&
        typeof parsed.positions === 'object' &&
        id in parsed.positions
      ) {
        const spot = (parsed.positions as Record<string, unknown>)[id];
        if (
          spot &&
          typeof spot === 'object' &&
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
          result.positions[id] = { x: spot.x, y: spot.y, width, height };
        }
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
  slow = false,
  stage = false,
  tunerOpen = false,
  children,
}: {
  connected: boolean;
  slow?: boolean;
  stage?: boolean;
  tunerOpen?: boolean;
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
    <LinkedSheetProvider connected={connected} slow={slow}>
      <TunerProvider
        watch={tunerOpen || (!!places.tuner && places.tuner !== 'closed')}
        start={tunerOpen}
        slow={slow}
      >
        <VenueProvider connected={connected}>
          <ToolDock
            tools={[
              {
                id: 'tuner',
                title: 'Tuner',
                icon: <Waveform />,
                render: () => (
                  <TunerTool stage={stage} onStart={requestTuner} />
                ),
              },
              {
                id: 'venue',
                title: 'Venue EQ',
                icon: <SlidersHorizontal />,
                render: () => <VenueEq connected={connected} />,
              },
              {
                id: 'backing',
                title: 'Backing',
                icon: <MusicNote />,
                render: () => <BackingTool />,
              },
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
        </VenueProvider>
      </TunerProvider>
    </LinkedSheetProvider>
  );
}
