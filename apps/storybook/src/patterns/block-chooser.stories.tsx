import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Button } from '../components/ui/button';
import { Caption } from '../components/ui/text';
import { BlockChooser } from './block-chooser';
import { EFFECTS } from './block-chooser.data';
import { MODELS } from './swap.fixtures';

/**
 * The + in the route opens this: a capture, an IR or an effect, with
 * search. In a TONE3000 chain an effect asks where it goes, because the
 * chain plays as one piece.
 */
const meta: Meta = {
  title: 'Patterns/Block chooser',
  parameters: { layout: 'padded' },
};
export default meta;

function Demo({ tone3000 = false }: { tone3000?: boolean }) {
  const [open, setOpen] = useState(true);
  const [added, setAdded] = useState('');
  return (
    <div className="grid gap-2">
      <Button className="justify-self-start" onClick={() => setOpen(true)}>
        Add a block
      </Button>
      <Caption role="status">{added || 'Nothing added yet.'}</Caption>
      <BlockChooser
        open={open}
        onOpenChange={setOpen}
        models={MODELS}
        effects={EFFECTS}
        tone3000Chain={tone3000}
        onChoose={(block, placement) =>
          setAdded(`Added ${block.label}${placement ? ` · ${placement}` : ''}`)
        }
      />
    </div>
  );
}

export const AnEffect: StoryObj = {
  name: 'Find and add an effect',
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole('button', { name: /^Effect/ }));
    await userEvent.type(
      page.getByRole('searchbox', { name: 'Find an effect' }),
      'reverb',
    );
    await expect(
      page.getByRole('button', { name: 'Install in Settings…' }),
    ).toBeVisible();
    await userEvent.click(
      page.getByRole('button', { name: 'Add Bloom reverb' }),
    );
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'Added Bloom',
    );
  },
};

export const IntoTone3000: StoryObj = {
  name: 'An effect beside a TONE3000 chain',
  render: () => <Demo tone3000 />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole('button', { name: /^Effect/ }));
    await userEvent.click(page.getByRole('button', { name: 'Add Echo delay' }));
    await userEvent.click(
      page.getByRole('button', { name: /^After the TONE3000 chain/ }),
    );
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'Added Echo · after',
    );
  },
};
