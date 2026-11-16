import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Button } from '../components/ui/button';
import { Guitars } from './guitars';
import { Levels } from './levels';
import { Settings } from './settings';
import { PlayerSheet } from './sheets';
import { Screen } from './shell';
import { Perform } from './perform';

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

export const DeviceDetails: StoryObj = {
  name: 'Levels · device details',
  render: () => (
    <Screen destination="levels">
      <Levels view="device" />
    </Screen>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Install plugin pack')).toBeVisible();
    await userEvent.click(canvas.getByRole('radio', { name: 'Refused' }));
    await expect(canvas.queryByText('Save preset')).toBeNull();
  },
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
export const SettingsNam = settings('nam', 'NAM engine');
export const SettingsEffects = settings('effects', 'Effects');
export const SettingsPlugins = settings('plugins', 'LV2');

/** LV2: install a pack, then remove the one presets use: it names them and asks first. */
SettingsPlugins.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(
    canvas.getByRole('button', { name: 'Install Dragonfly Reverb' }),
  );
  await expect(
    await canvas.findByRole(
      'button',
      { name: 'Remove Dragonfly Reverb…' },
      { timeout: 3000 },
    ),
  ).toBeVisible();
  await userEvent.click(
    canvas.getByRole('button', { name: 'Remove Guitarix…' }),
  );
  const dialog = within(
    await page.findByRole('dialog', { name: 'Remove Guitarix?' }),
  );
  await expect(dialog.getByText('Brown Crunch')).toBeVisible();
  const remove = dialog.getByRole('button', { name: 'Remove pack' });
  await expect(remove).toBeDisabled();
  await userEvent.click(dialog.getByRole('checkbox'));
  await userEvent.click(remove);
  await expect(
    canvas.getByRole('button', { name: 'Install Guitarix' }),
  ).toBeVisible();
};
export const SettingsDisplay = settings('display', 'Display');
export const SettingsDevice = settings('device', 'Device');
export const SettingsMaintenance = settings('maintenance', 'Maintenance');
export const SettingsAbout = settings('about', 'About');

function WithPlayer() {
  const [open, setOpen] = useState(true);
  return (
    <Screen destination="rig">
      <Perform />
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
