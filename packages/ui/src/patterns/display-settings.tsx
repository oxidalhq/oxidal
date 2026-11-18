import type { ReactNode } from 'react';

import { Button } from '../components/ui/button';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Switch } from '../components/ui/switch';
import { SettingGroup, SettingRow } from './settings-page';

/**
 * Approved Display settings, controlled by the browser session owner.
 * @see docs/interface.md
 */
export function DisplaySettings({
  mode,
  onModeChange,
  status,
  onStatusChange,
  keepAwake,
  onKeepAwakeChange,
  wakeSupported = true,
  wakeStatus,
  onRetryWake,
  fullscreen,
  fullscreenSupported = true,
  fullscreenError,
  onToggleFullscreen,
  help,
}: {
  mode: string;
  onModeChange: (mode: string) => void;
  status: 'simple' | 'detailed';
  onStatusChange: (status: 'simple' | 'detailed') => void;
  keepAwake: boolean;
  onKeepAwakeChange: (enabled: boolean) => void;
  wakeSupported?: boolean;
  wakeStatus?: 'off' | 'requesting' | 'active' | 'paused' | 'denied';
  onRetryWake?: () => void;
  fullscreen: boolean;
  fullscreenSupported?: boolean;
  fullscreenError?: string;
  onToggleFullscreen: () => void;
  help?: ReactNode;
}) {
  return (
    <>
      <SettingGroup title="Look">
        <SettingRow
          label="Display mode"
          caption="Night for the stage, Sunlight outdoors, E-paper on BOOX."
          stacked
        >
          <SegmentedControl
            value={mode}
            onValueChange={onModeChange}
            aria-label="Display mode"
            className="w-full"
          >
            <Segment value="default">Default</Segment>
            <Segment value="stage">Night</Segment>
            <Segment value="sunlight">Sunlight</Segment>
            <Segment value="epaper">E-paper</Segment>
          </SegmentedControl>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Device status">
        <SettingRow
          label="Status at the top"
          caption={
            status === 'simple'
              ? 'One word: All good, Busy, Dropouts or Running hot. Tap it for the numbers.'
              : 'The full strip: processing, CPU, memory, temperature, dropouts and clips.'
          }
          stacked
        >
          <SegmentedControl
            value={status}
            onValueChange={(value) =>
              onStatusChange(value === 'detailed' ? 'detailed' : 'simple')
            }
            aria-label="Status at the top"
            className="w-full"
          >
            <Segment value="simple">Simple</Segment>
            <Segment value="detailed">Detailed</Segment>
          </SegmentedControl>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Screen">
        <SettingRow
          id="screen-awake"
          label="Keep screen awake"
          caption="While this page is open."
        >
          <Switch
            id="screen-awake"
            checked={keepAwake}
            onCheckedChange={onKeepAwakeChange}
            disabled={!wakeSupported}
          />
        </SettingRow>
        {wakeStatus !== undefined && (
          <p
            role="status"
            aria-label="Screen awake status"
            className="my-2 text-sm text-muted-foreground"
          >
            {!wakeSupported
              ? 'Keep-awake unavailable: use HTTPS and a supported browser.'
              : {
                  off: 'Screen awake: off',
                  requesting: 'Screen awake: requesting',
                  active: 'Screen awake: active',
                  paused: 'Screen awake: paused by browser',
                  denied:
                    'Screen awake: not allowed by browser or power settings',
                }[wakeStatus]}
          </p>
        )}
        {keepAwake &&
          wakeSupported &&
          (wakeStatus === 'paused' || wakeStatus === 'denied') &&
          onRetryWake && (
            <Button
              size="sm"
              variant="outline"
              className="justify-self-start"
              onClick={onRetryWake}
            >
              Retry keep-awake
            </Button>
          )}
        <SettingRow label="Fullscreen">
          <Button
            size="sm"
            variant="outline"
            disabled={!fullscreenSupported}
            onClick={onToggleFullscreen}
          >
            {fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          </Button>
        </SettingRow>
        {!fullscreenSupported && (
          <p className="my-2 text-sm text-muted-foreground">
            Page fullscreen is unavailable in this browser.
          </p>
        )}
        {fullscreenError && (
          <p role="alert" className="my-2 text-sm text-destructive">
            {fullscreenError}
          </p>
        )}
      </SettingGroup>
      {help}
    </>
  );
}
