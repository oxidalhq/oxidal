import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from './button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleSection,
  CollapsibleTrigger,
} from './collapsible';
import { NoticeTray } from './notice-tray';
import { notify, useNotice } from './notices';
import { ScrollArea } from './scroll-area';
import { Switch } from './switch';
import { Caption } from './text';

/**
 * Notices: state notices stay while the condition holds; toasts leave by
 * themselves. Both appear in the one tray. Scroll area and collapsible
 * are the two remaining containers.
 */
const meta: Meta = {
  title: 'Components/Notices, scroll area, collapsible',
  parameters: { layout: 'padded' },
};
export default meta;

function TrayDemo() {
  const [lost, setLost] = useState(true);
  const [failed, setFailed] = useState(false);
  useNotice(
    'connection',
    lost ? { tone: 'warning', text: 'Connection lost · reconnecting' } : null,
  );
  useNotice(
    'audio',
    failed
      ? {
          tone: 'error',
          text: 'Audio stopped unexpectedly',
          action: { label: 'Audio setup', run: () => setFailed(false) },
        }
      : null,
  );
  return (
    <div className="grid max-w-md gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm">Connection lost</span>
        <Switch
          checked={lost}
          onCheckedChange={setLost}
          aria-label="Connection lost"
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm">Audio failed</span>
        <Switch
          checked={failed}
          onCheckedChange={setFailed}
          aria-label="Audio failed"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() =>
            notify({ tone: 'success', text: 'Saved “Iron Pulse”' })
          }
        >
          Toast: saved
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            notify({
              tone: 'error',
              text: 'Could not split: not enough free space',
              action: { label: 'Storage', run: () => {} },
            })
          }
        >
          Toast: error
        </Button>
      </div>
      <Caption>
        A state notice is held two seconds after it clears, so flapping does not
        blink. Dismissing hides it until the text changes.
      </Caption>
      <NoticeTray placement="inline" />
    </div>
  );
}

export const Tray: StoryObj = { render: () => <TrayDemo /> };

export const Scrolling: StoryObj = {
  name: 'Scroll area',
  render: () => (
    <ScrollArea className="h-48 max-w-sm rounded-lg border border-border">
      <div className="grid">
        {Array.from({ length: 24 }, (_, index) => (
          <div
            key={index}
            className="flex min-h-touch items-center border-b border-border px-3 text-sm last:border-b-0"
          >
            Preset {index + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const Collapsibles: StoryObj = {
  name: 'Collapsible',
  render: () => (
    <div className="grid max-w-md gap-2">
      <CollapsibleSection title="Advanced">
        <Caption>
          Latency compensation, oversampling and worker priority.
        </Caption>
      </CollapsibleSection>
      <Collapsible defaultOpen>
        <CollapsibleTrigger>Details</CollapsibleTrigger>
        <CollapsibleContent className="px-2 pb-2 pl-7.5">
          <code className="text-xs">
            alsa: EPIPE after 3 recoveries in 24 ms (playback)
          </code>
        </CollapsibleContent>
      </Collapsible>
    </div>
  ),
};
