import { NoticeTray } from '@oxidal/design-system/components/notice-tray';
import { ResourceStrip as SharedResourceStrip } from '@oxidal/design-system/widgets/resource-strip';

import { useResourceStatus } from './useResourceStatus';

/**
 * Persistent measured resources; diagnostics can freeze without freezing this
 * strip. It also holds the app's notice tray, so problems float under it
 * instead of adding a row that shifts the page.
 */
export function ResourceStrip({
  displayMode,
  connected,
  onAudioSetup,
}: {
  displayMode: string;
  connected: boolean;
  onAudioSetup?: () => void;
}) {
  const resource = useResourceStatus(displayMode, connected, onAudioSetup);
  return (
    <aside
      aria-label="DSP and system resources"
      data-connected={resource.connected}
    >
      <span className="sr-only" data-testid="resource-state">
        {resource.label}
      </span>
      <SharedResourceStrip
        readings={resource.readings}
        state={resource.state}
      />
      <NoticeTray />
    </aside>
  );
}
