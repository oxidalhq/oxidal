import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@/components/ui/button';
import { Guitars } from './guitars';
import { Levels } from './levels';
import { Settings } from './settings';
import { PlayerSheet } from './sheets';
import { Screen } from './shell';
import { Stage } from './stage';

const meta: Meta = {
  title: 'Screens/Guitars, Levels, Settings, sheets',
  parameters: { layout: 'fullscreen' },
};
export default meta;

export const GuitarsScreen: StoryObj = {
  name: 'Guitars',
  render: () => (
    <Screen destination="guitars">
      <Guitars />
    </Screen>
  ),
};

export const LevelsScreen: StoryObj = {
  name: 'Levels',
  render: () => (
    <Screen destination="levels">
      <Levels />
    </Screen>
  ),
};

const settings = (section: string, name: string): StoryObj => ({
  name: `Settings · ${name}`,
  render: () => (
    <Screen destination="settings">
      <Settings section={section} />
    </Screen>
  ),
});

export const SettingsAudio = settings('audio', 'Audio');
export const SettingsNetwork = settings('connections', 'Network');
export const SettingsAccounts = settings('accounts', 'Accounts');
export const SettingsMidi = settings('midi', 'MIDI');
export const SettingsEffects = settings('effects', 'Effects');
export const SettingsDisplay = settings('display', 'Display');
export const SettingsDevice = settings('device', 'Device');
export const SettingsMaintenance = settings('maintenance', 'Maintenance');
export const SettingsAbout = settings('about', 'About');

function WithPlayer() {
  const [open, setOpen] = useState(true);
  return (
    <Screen destination="rig">
      <Stage />
      <div className="fixed right-page bottom-20 z-strip md:bottom-page">
        <Button onClick={() => setOpen(true)}>Open player</Button>
      </div>
      <PlayerSheet open={open} onOpenChange={setOpen} />
    </Screen>
  );
}

export const PlayerOverStage: StoryObj = {
  name: 'Player sheet over the stage',
  render: () => <WithPlayer />,
};
