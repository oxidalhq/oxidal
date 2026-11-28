import type { Meta, StoryObj } from '@storybook/react-vite';

import { ArtworkMosaic } from './artwork-mosaic';

const meta: Meta<typeof ArtworkMosaic> = {
  title: 'Widgets/Artwork mosaic',
  component: ArtworkMosaic,
  parameters: { layout: 'padded' },
};
export default meta;

const pictures = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    src: i % 2 ? '/examples/plugin-art.svg' : '/examples/amp-head.svg',
    title: `Model ${i + 1}`,
  }));

/** A preset's cover from one, two, three and six model pictures. */
export const Covers: StoryObj = {
  render: () => (
    <div className="grid max-w-3xl grid-cols-4 gap-4">
      {[1, 2, 3, 6].map((n) => (
        <span
          key={n}
          className="relative grid aspect-square overflow-hidden rounded-pad border border-border bg-card"
        >
          <ArtworkMosaic sources={pictures(n)} />
        </span>
      ))}
    </div>
  ),
};
