import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Faders,
  ListNumbers,
  MusicNotes,
  Plug,
  Stack,
  User,
} from '@phosphor-icons/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Caption } from './text';

/**
 * Sections of one workspace. The active tab is underlined in ink. The list
 * scrolls sideways with edge fades on narrow screens; resize the viewport
 * to see it.
 */
const meta: Meta = {
  title: 'Components/Tabs',
  parameters: { layout: 'padded' },
};
export default meta;

const SECTIONS = [
  ['mine', 'Mine', <User key="i" />],
  ['oxidal', 'Oxidal sounds', <Stack key="i" />],
  ['setlist', 'Set list', <ListNumbers key="i" />],
  ['backing', 'Backing tracks', <MusicNotes key="i" />],
  ['stems', 'Stems', <Faders key="i" />],
  ['di', 'DI and reamps', <Plug key="i" />],
] as const;

export const Library: StoryObj = {
  render: () => (
    <Tabs defaultValue="mine" className="grid max-w-2xl gap-4">
      <TabsList aria-label="Library sections">
        {SECTIONS.map(([value, label, icon]) => (
          <TabsTrigger key={value} value={value}>
            {icon}
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {SECTIONS.map(([value, label]) => (
        <TabsContent key={value} value={value}>
          <Caption>{label}: the section's list goes here.</Caption>
        </TabsContent>
      ))}
    </Tabs>
  ),
};
