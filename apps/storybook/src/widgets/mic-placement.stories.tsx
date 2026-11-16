import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { MicPlacement, type Mic } from './mic-placement';

/**
 * Mic placement on a cab, as Helix Stadium draws it: drag each mic on the
 * speaker (front) and away from it (side). Two mics blend.
 */
const meta: Meta = {
  title: 'Widgets/Mic placement',
  parameters: { layout: 'padded' },
};
export default meta;

function Demo({ two = false }: { two?: boolean }) {
  const [mics, setMics] = useState<Mic[]>(
    two
      ? [
          { name: 'SM57', position: 0.3, angle: -20, distance: 2 },
          { name: 'R121', position: 0.6, angle: 30, distance: 8 },
        ]
      : [{ name: 'SM57', position: 0.3, angle: 0, distance: 2 }],
  );
  const [blend, setBlend] = useState(35);
  return (
    <div className="max-w-md rounded-lg border border-border bg-raised p-3 shadow-raised">
      <MicPlacement
        mics={mics}
        onChange={(i, mic) =>
          setMics((all) => all.map((m, j) => (j === i ? mic : m)))
        }
        blend={blend}
        onBlend={setBlend}
      />
    </div>
  );
}

export const OneMic: StoryObj = { name: 'One mic', render: () => <Demo /> };
export const TwoMics: StoryObj = {
  name: 'Two mics, blended',
  render: () => <Demo two />,
};

OneMic.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const position = canvas.getByRole('slider', {
    name: 'SM57, position on the speaker',
  });
  position.focus();
  await userEvent.keyboard('{ArrowRight}{ArrowRight}');
  await expect(position).toHaveAttribute('aria-valuenow', '40');
  await expect(canvas.getByText(/Cone · 2 cm/)).toBeVisible();
  const distance = canvas.getByRole('slider', {
    name: 'SM57, distance from the grille',
  });
  distance.focus();
  await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
  await expect(distance).toHaveAttribute('aria-valuenow', '8');
};
