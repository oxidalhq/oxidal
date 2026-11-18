import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Caption, Title } from '../components/ui/text';
import { ToolDockDemo } from './tool-dock.demo';

/**
 * Tools kept open beside the page: the backing track, the chord sheet, the
 * venue EQ and the tuner. A tool opens as a sheet; from there float it or
 * pin it left or right, and it stays while you work.
 */
const meta: Meta = {
  title: 'Patterns/Tool dock',
  parameters: { layout: 'fullscreen' },
};
export default meta;

const page = (
  <div className="grid gap-2 p-page">
    <Title size="md">Any page</Title>
    <Caption>
      The page keeps working while a tool floats over it or sits beside it.
    </Caption>
    <div className="h-64 rounded-lg border border-dashed border-border" />
  </div>
);

/** Open the venue EQ as a sheet, float it, then pin it on the right. */
export const OpenAndPin: StoryObj = {
  name: 'Open as a sheet, float, then pin',
  render: () => <ToolDockDemo>{page}</ToolDockDemo>,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const canvas = within(canvasElement);
    const width = canvasElement.ownerDocument.defaultView!.innerWidth;
    await userEvent.click(
      canvas.getByRole('button', { name: 'Venue EQ panel' }),
    );
    // Every tool opens as a sheet first.
    const sheet = within(await body.findByRole('dialog', { name: 'Venue EQ' }));
    if (width < 768) return;
    await userEvent.click(
      sheet.getByRole('button', { name: 'Float: Venue EQ' }),
    );
    const panel = await waitFor(() => {
      const found = canvasElement.querySelector<HTMLElement>(
        '[data-slot=tool-panel]',
      );
      if (!found) throw new Error('The tool has not floated');
      return found;
    });
    await expect(panel).toHaveAttribute('data-place', 'float');
    // A floating tool can always go back to being a sheet.
    await userEvent.click(
      within(panel).getByRole('button', { name: 'Open as a sheet: Venue EQ' }),
    );
    const again = within(await body.findByRole('dialog', { name: 'Venue EQ' }));
    if (width < 1024) return;
    await userEvent.click(
      again.getByRole('button', { name: 'Pin right: Venue EQ' }),
    );
    await expect(
      canvas
        .getByRole('complementary', { name: 'Pinned on the right' })
        .querySelector('[data-slot=tool-panel]'),
    ).toHaveAttribute('data-place', 'right');
    return;
    await userEvent.click(
      within(panel).getByRole('button', { name: 'Pin right: Venue EQ' }),
    );
    await expect(
      canvas
        .getByRole('complementary', { name: 'Pinned on the right' })
        .querySelector('[data-slot=tool-panel]'),
    ).toHaveAttribute('data-place', 'right');
  },
};

/** The backing track on the right and the chord sheet on the left. */
export const BothSides: StoryObj = {
  name: 'Backing track and chords pinned',
  render: () => (
    <ToolDockDemo initial={{ backing: 'right', chords: 'left' }}>
      {page}
    </ToolDockDemo>
  ),
};
