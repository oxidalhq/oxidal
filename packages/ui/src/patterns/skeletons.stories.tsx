import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Caption } from '../components/ui/text';
import { STACK_CREDITS } from '../lib/credits';
import { Credits, PoweredByTone3000 } from './credits';
import {
  LibrarySkeleton,
  LoadingScreen,
  PlayerSkeleton,
  RigSkeleton,
  SettingsSkeleton,
} from './skeletons';

/**
 * Screens while they load, and the credits. A skeleton is the page itself
 * in grey; after two seconds a line says what is still loading. No
 * spinners: older and non-technical players read words, not animation.
 */
const meta: Meta = {
  title: 'Patterns/Loading screens and credits',
  parameters: { layout: 'fullscreen' },
};
export default meta;

export const Rig: StoryObj = { render: () => <RigSkeleton /> };
export const Library: StoryObj = { render: () => <LibrarySkeleton /> };
export const LibraryArtwork: StoryObj = {
  name: 'Library (artwork)',
  render: () => <LibrarySkeleton artwork />,
};
export const Settings: StoryObj = { render: () => <SettingsSkeleton /> };
export const Player: StoryObj = { render: () => <PlayerSkeleton /> };

function SlowModels() {
  const [done, setDone] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setDone((d) => (d >= 300 ? 0 : d + 7)),
      200,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <LoadingScreen
      skeleton={<LibrarySkeleton artwork rows={4} />}
      label="Loading your models"
      detail={`${done} of 300 models`}
      progress={(done / 300) * 100}
      after={0}
    />
  );
}

export const SlowLoad: StoryObj = {
  name: 'Slow load with progress',
  render: () => <SlowModels />,
};

export const SlowLoadUnknown: StoryObj = {
  name: 'Slow load, no progress known',
  render: () => (
    <LoadingScreen
      skeleton={<RigSkeleton />}
      label="Starting audio"
      after={0}
    />
  ),
};

export const CreditBadges: StoryObj = {
  name: 'Credits',
  parameters: { layout: 'padded' },
  render: () => (
    <div className="grid gap-6">
      <Credits credits={STACK_CREDITS} />
      <div className="rounded-lg bg-enclosure p-6">
        <Credits credits={STACK_CREDITS.slice(0, 4)} dark />
      </div>
      <div className="grid gap-2">
        <PoweredByTone3000
          creator={{ name: 'Jane Capture', href: '#' }}
          licence={{ name: 'CC BY 4.0', href: '#' }}
        />
        <PoweredByTone3000
          creator={{ name: 'Studio Pack' }}
          licence={{ name: 'TONE3000 only' }}
        />
        <PoweredByTone3000 />
      </div>
      <Caption className="max-w-prose">
        Logos appear only where the file and its terms are in the repository
        (`THIRD_PARTY.md`); the rest are set in type until their marks are
        cleared. The TONE3000 line sits beside every catalogue tone with the
        creator and the capture's licence.
      </Caption>
    </div>
  ),
};
