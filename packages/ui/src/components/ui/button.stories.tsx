import { FloppyDisk, Play, Plus, Trash } from '@phosphor-icons/react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './button';

/**
 * Use `default` for the one action the screen is for (Save, Play, Split).
 * `outline` for the others; `ghost` for navigation and row actions;
 * `destructive` for Delete and Remove (danger ink, confirm follows);
 * `link` inside sentences. Sizes: `sm` in dense rows, `md` (44 px) by
 * default, `lg` on the stage.
 */
const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Save rig' },
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'outline',
        'secondary',
        'ghost',
        'destructive',
        'link',
      ],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'icon', 'icon-sm', 'icon-lg'],
    },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};
export default meta;
type Story = StoryObj<typeof Button>;

export const Playground: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Save</Button>
      <Button variant="outline">Open</Button>
      <Button variant="secondary">Duplicate</Button>
      <Button variant="ghost">Edit</Button>
      <Button variant="destructive">Delete…</Button>
      <Button variant="link">Audio setup</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button>Default</Button>
      <Button size="lg">Stage</Button>
      <Button size="icon-sm" variant="outline" aria-label="Add">
        <Plus />
      </Button>
      <Button size="icon" variant="outline" aria-label="Add">
        <Plus />
      </Button>
      <Button size="icon-lg" variant="outline" aria-label="Add">
        <Plus />
      </Button>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button loading>Saving</Button>
      <Button variant="outline" loading>
        Splitting
      </Button>
      <Button disabled>Disabled</Button>
      <Button variant="outline" disabled>
        Disabled
      </Button>
    </div>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <Play weight="fill" /> Play
      </Button>
      <Button variant="outline">
        <FloppyDisk /> Save as…
      </Button>
      <Button variant="destructive">
        <Trash /> Delete…
      </Button>
    </div>
  ),
};

export const AsLink: Story = {
  render: () => (
    <Button asChild variant="outline">
      <a href="#settings/audio">Audio setup</a>
    </Button>
  ),
};
