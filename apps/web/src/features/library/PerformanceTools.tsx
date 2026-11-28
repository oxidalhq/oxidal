import type { ReactNode } from 'react';

import {
  layoutOf,
  placeOf,
  useDockLayout,
} from '@oxidal/design-system/lib/dock-layout';

import { VenueProvider } from '../../components/media/VenueEq';
import { TunerProvider } from '../../GlobalTuner';
import { AppDock } from '../dock/AppDock';
import { LinkedSheetProvider } from './LinkedSheet';

/**
 * The tools kept beside every screen and what they share: the linked chord
 * sheet, the tuner (listening only while it shows) and the venue EQ. Moving
 * a tool is presentation only: it sends no player or rig command.
 * @see docs/interface.md
 */
export function PerformanceTools({
  connected,
  slow = false,
  stage = false,
  tunerOpen = false,
  rig = false,
  children,
}: {
  connected: boolean;
  slow?: boolean;
  stage?: boolean;
  tunerOpen?: boolean;
  /** The Rig is showing: it offers its set list and places the bottom zone itself. */
  rig?: boolean;
  children: ReactNode;
}) {
  // This browser keeps where the tools are; they start closed.
  const [layout, setLayout] = useDockLayout('oxidal.dock.v1', layoutOf({}));
  return (
    <LinkedSheetProvider connected={connected} slow={slow}>
      <TunerProvider
        watch={tunerOpen || placeOf(layout, 'tuner') !== 'closed'}
        start={tunerOpen}
        slow={slow}
      >
        <VenueProvider connected={connected}>
          <AppDock
            layout={layout}
            onLayout={setLayout}
            connected={connected}
            stage={stage}
            setList={rig}
            placeBottom={!rig}
          >
            {children}
          </AppDock>
        </VenueProvider>
      </TunerProvider>
    </LinkedSheetProvider>
  );
}
