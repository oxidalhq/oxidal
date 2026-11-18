import { MusicNotes, Plug, Stack } from '@phosphor-icons/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from './button';
import {
  EmptyState,
  Loading,
  Progress,
  Skeleton,
  SkeletonRows,
  StateNotice,
  StepProgress,
} from './states';
import { Caption } from './text';

/**
 * Loading, empty and working. An app-wide error goes to the notice tray;
 * StateNotice composes a section's error from a Card and one recovery action.
 */
const meta: Meta = {
  title: 'Components/Loading, empty, progress',
  parameters: { layout: 'padded' },
};
export default meta;

export const Skeletons: StoryObj = {
  render: () => (
    <div className="grid max-w-md gap-6">
      <SkeletonRows rows={4} />
      <div className="grid gap-2">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  ),
};

export const LoadingLine: StoryObj = {
  name: 'Loading',
  render: () => (
    <div className="grid gap-2">
      <Loading label="Loading Library…" delay={0} />
      <Caption>Shown only after 300 ms, so quick loads never flash.</Caption>
    </div>
  ),
};

export const Empty: StoryObj = {
  name: 'Empty state',
  render: () => (
    <div className="grid max-w-md gap-4">
      <EmptyState
        icon={<Stack />}
        title="No presets yet"
        action={<Button>New preset</Button>}
      >
        Create one, or start from Oxidal sounds.
      </EmptyState>
      <EmptyState
        icon={<MusicNotes />}
        title="No songs with stems"
        action={
          <div className="flex gap-2">
            <Button>Split a track…</Button>
            <Button variant="outline">Import stems…</Button>
          </div>
        }
      >
        Split one of your backing tracks, or import stems exported from another
        app.
      </EmptyState>
      <EmptyState icon={<Plug />} title="No audio device">
        Connect an interface and open Audio setup.
      </EmptyState>
    </div>
  ),
};

function RecoveryDemo() {
  const [retrying, setRetrying] = useState(false);
  return retrying ? (
    <Loading label="Reading guitar profiles…" delay={0} />
  ) : (
    <StateNotice
      kind="error"
      title="Guitar profiles unavailable"
      action={<Button onClick={() => setRetrying(true)}>Try again</Button>}
    >
      The device did not reply. Your saved profiles are unchanged.
    </StateNotice>
  );
}

export const SectionRecovery: StoryObj = {
  name: 'Section error and recovery',
  render: () => <RecoveryDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'Guitar profiles unavailable',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Reading guitar profiles…',
    );
    await expect(canvas.queryByRole('alert')).toBeNull();
  },
};

export const Bars: StoryObj = {
  name: 'Progress',
  render: () => (
    <div className="grid max-w-md gap-6">
      <div className="grid gap-1">
        <div className="flex justify-between text-sm">
          <span>Splitting into 6 stems</span>
          <span className="font-mono">42%</span>
        </div>
        <Progress label="Splitting" value={42} />
      </div>
      <div className="grid gap-1">
        <span className="text-sm">Preparing…</span>
        <Progress label="Preparing" />
      </div>
      <StepProgress
        label="Playing Iron Pulse"
        steps={['Loading models', 'Starting audio', 'Cueing track']}
        current={1}
        onCancel={() => {}}
      />
    </div>
  ),
};
