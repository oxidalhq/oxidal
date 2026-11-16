import type { Meta, StoryObj } from '@storybook/react-vite';
import { Play, Plus, Trash } from '@phosphor-icons/react';
import { Button } from './button';

/**
 * The product's button as it ships today (copied from oxidal-main). The
 * baseline for the Sprint 15 rework: every variant it has, so the new one
 * can be compared against it.
 */
const meta: Meta<typeof Button> = {
  title: 'Baseline/Button',
  component: Button,
  args: { children: 'Save rig' },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'outline', 'secondary', 'ghost', 'destructive'],
    },
    size: { control: 'select', options: ['default', 'icon'] },
  },
};
export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Save</Button>
      <Button variant="outline">Open</Button>
      <Button variant="secondary">Duplicate</Button>
      <Button variant="ghost">Edit</Button>
      <Button variant="destructive">Delete…</Button>
      <Button disabled>Disabled</Button>
    </div>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <Play aria-hidden="true" weight="fill" /> Play
      </Button>
      <Button variant="outline">
        <Plus aria-hidden="true" /> Add block
      </Button>
      <Button variant="outline" size="icon" aria-label="Delete">
        <Trash aria-hidden="true" />
      </Button>
    </div>
  ),
};
