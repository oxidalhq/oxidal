import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { VenueEq } from './venue-eq';
import { VENUE_PROFILES } from './venue-eq.data';

/**
 * The venue EQ from Settings › Audio › Output, now in Levels › Output: drag
 * a band on the graph or pick it below, set frequency, gain and Q, trim the
 * output and watch the peak boost. The curve uses the device's own filters.
 */
const meta: Meta<typeof VenueEq> = {
  title: 'Widgets/Venue EQ',
  component: VenueEq,
  args: { profiles: VENUE_PROFILES },
  parameters: { layout: 'padded' },
};
export default meta;

export const Flat: StoryObj<typeof VenueEq> = {
  name: 'Flat, then boost the high mid',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = userEvent.setup({ document: canvasElement.ownerDocument });
    await input.click(canvas.getByRole('button', { name: /^HM/ }));
    const gain = canvas.getByRole('slider', { name: 'High mid gain' });
    gain.focus();
    for (let i = 0; i < 6; i++) await input.keyboard('{ArrowUp}');
    await expect(await canvas.findByText(/Peak boost \+3\.0 dB/)).toBeVisible();
    await input.click(canvas.getByRole('button', { name: 'Revert' }));
    await expect(await canvas.findByText(/Peak boost 0\.0 dB/)).toBeVisible();
  },
};

export const FridayGig: StoryObj<typeof VenueEq> = {
  name: 'Friday gig profile',
  args: { profiles: [VENUE_PROFILES[2]!, ...VENUE_PROFILES.slice(0, 2)] },
};
