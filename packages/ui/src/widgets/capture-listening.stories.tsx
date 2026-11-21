import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import {
  BrowserListeningDemo,
  CaptureReferencesDemo,
} from './capture-listening.demo';

export default {
  title: 'Levels/Capture listening',
  parameters: { layout: 'padded' },
} satisfies Meta;

export const CaptureReferences: StoryObj = {
  render: () => <CaptureReferencesDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reference = canvas.getByRole('spinbutton', {
      name: 'Interface input reference (dBu)',
    });
    await userEvent.type(reference, '-10');
    await expect(reference).toHaveValue(-10);
    await expect(canvas.getByText('Applied guitar trim -6.0 dB')).toBeVisible();
    await expect(canvas.getAllByText('Capture output Unknown')).toHaveLength(2);
  },
};

export const BrowserAudition: StoryObj = {
  render: () => <BrowserListeningDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Open browser audition' }),
    );
    const measure = canvas.getByRole('button', { name: 'Measure pair' });
    await expect(measure).toBeDisabled();
    await userEvent.selectOptions(canvas.getByLabelText('Reamp A'), 'clean');
    await userEvent.selectOptions(canvas.getByLabelText('Reamp B'), 'lead');
    await userEvent.click(measure);
    await expect(
      canvas.getByText('B · -18.0 dBFS RMS · -6.0 dB browser trim'),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole('checkbox', { name: 'Match browser playback' }),
    );
    await expect(
      canvas.getByText('B · -18.0 dBFS RMS · 0.0 dB browser trim'),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Close audition' }),
    );
    await expect(canvas.queryByRole('button', { name: 'Play A' })).toBeNull();
  },
};
