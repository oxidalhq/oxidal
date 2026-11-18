import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { expect, userEvent, within } from 'storybook/test';

import {
  ModelBrowser,
  type ModelChoice,
  type ToneCatalogueStatus,
} from './model-browser';
import { useModelDownloads } from './swap.demo';
import { MODELS } from './swap.fixtures';

/** Find the next tone from the rig: the device and TONE3000 in one list. */
const meta: Meta = {
  title: 'Patterns/Model browser',
  parameters: { layout: 'padded' },
};
export default meta;

function Browser({ status }: { status?: ToneCatalogueStatus }) {
  const store = useModelDownloads(MODELS);
  const [playing, setPlaying] = React.useState<string | null>('plexi');
  const [wanted, setWanted] = React.useState<ModelChoice | null>(null);
  return (
    <div className="mx-auto max-w-xl">
      <ModelBrowser
        models={store.models}
        kind="amp"
        playing={wanted ? null : playing}
        downloads={store.downloads}
        catalogue={status ? { ...store.catalogue, status } : store.catalogue}
        onTry={(m) => {
          setWanted(null);
          setPlaying(m.id);
        }}
        onGet={store.onGet}
      />
    </div>
  );
}

export const SearchFilterAndTry: StoryObj = {
  name: 'Search, filter, open a tone and try it',
  render: () => <Browser />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByRole('searchbox', { name: 'Search models' }),
      'plexi',
    );
    await expect(
      await canvas.findByRole('button', { name: 'Try Plexi lead 1969' }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole('button', { name: 'Try JCM 800 crunch' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole('button', { name: /^Plexi lead 1969/ }),
    );
    await expect(
      await canvas.findByRole('region', { name: 'About Plexi lead 1969' }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Try Plexi lead 1969' }),
    );
    await expect(await canvas.findAllByText('Playing')).toHaveLength(1);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Clear filters' }),
    );
    await expect(
      await canvas.findByRole('button', { name: 'Try JCM 800 crunch' }),
    ).toBeVisible();
  },
};

export const OnlyTone3000: StoryObj = {
  name: 'Only TONE3000, with more to load',
  render: () => <Browser />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: 'TONE3000' }));
    await expect(
      canvas.queryByRole('region', { name: 'On this device' }),
    ).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Show more' }));
    await expect(
      await canvas.findByRole('button', { name: 'Try Silver anniversary' }),
    ).toBeVisible();
  },
};

export const SignedOut: StoryObj = {
  name: 'Not signed in to TONE3000',
  render: () => <Browser status={{ state: 'signed-out' }} />,
};

export const Offline: StoryObj = {
  name: 'No internet',
  render: () => <Browser status={{ state: 'offline' }} />,
};

export const Searching: StoryObj = {
  name: 'Searching',
  render: () => <Browser status={{ state: 'searching' }} />,
};

export const Failed: StoryObj = {
  name: 'TONE3000 did not answer',
  render: () => (
    <Browser
      status={{
        state: 'failed',
        message: 'The search timed out. Models on this device still work.',
      }}
    />
  ),
};
