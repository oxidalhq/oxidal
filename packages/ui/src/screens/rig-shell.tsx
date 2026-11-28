import { type ReactNode, useState } from 'react';

import {
  RigBottomTabs,
  type RigDestination,
  RigTopBar,
} from '../patterns/rig-top-bar';
import { ResourceStrip } from '../widgets/resource-strip';
import { READINGS } from './fixtures';

/**
 * The Rig screen's frame: the dark top bar (menu, peaks, health) on a tablet
 * or wider, the bottom tabs on a phone, and the Rig filling the height
 * between them. Detailed status adds the full resource strip under the bar.
 */
export function RigScreen({
  status = 'simple',
  children,
}: {
  status?: 'simple' | 'detailed';
  children: ReactNode;
}) {
  const [where, setWhere] = useState<RigDestination>('rig');
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <RigTopBar
        destination={where}
        onNavigate={setWhere}
        levels={{ input: [-14, -16], output: [-9, -10] }}
        readings={READINGS}
      />
      {status === 'detailed' && (
        <aside aria-label="DSP and system resources">
          <ResourceStrip readings={READINGS} />
        </aside>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <RigBottomTabs destination={where} onNavigate={setWhere} />
    </div>
  );
}
