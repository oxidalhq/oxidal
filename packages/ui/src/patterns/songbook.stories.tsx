import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { parseSong } from '../lib/song';
import { type SheetDraft, Songbook, SongbookEditor } from './songbook';

const SOURCE =
  '{title: Harbour lights}\n{key: G}\n[G]Carry the [D]light\n[Em]Home through the [C]night';
const meta: Meta = {
  title: 'Patterns/Songbook',
  parameters: { layout: 'fullscreen' },
};
export default meta;

function Demo({ refuse = false }: { refuse?: boolean }) {
  const [saved, setSaved] = useState<SheetDraft>({
    title: 'Harbour lights',
    source: SOURCE,
    format: 'chordpro',
  });
  const [draft, setDraft] = useState<SheetDraft | null>(null);
  const [query, setQuery] = useState('');
  const [size, setSize] = useState(3);
  const [speed, setSpeed] = useState(4);
  const [error, setError] = useState('');
  return (
    <div className="p-page">
      <Songbook
        items={[
          { id: 'harbour', title: saved.title, caption: 'ChordPro · Key G' },
        ]}
        selected="harbour"
        query={query}
        onQuery={setQuery}
        onOpen={fn()}
        onImport={fn()}
        onNew={() => {
          setError('');
          setDraft({ title: '', source: '', format: 'chordpro' });
        }}
        onEdit={() => {
          setError('');
          setDraft(saved);
        }}
        onLink={fn()}
        onDownload={fn()}
        onDelete={fn()}
        song={{ ...parseSong(saved.source, saved.format), title: saved.title }}
        size={size}
        onSize={setSize}
        speed={speed}
        onSpeed={setSpeed}
      />
      {draft && (
        <SongbookEditor
          open
          onOpenChange={(open) => {
            if (!open) setDraft(null);
          }}
          value={draft}
          onChange={setDraft}
          error={error && <p role="alert">{error}</p>}
          onSave={() => {
            if (refuse) {
              setError('The saved version changed. Your text has been kept.');
              return;
            }
            setSaved(draft);
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}

export const ConnectedLayout: StoryObj = {
  name: 'List and sheet',
  render: () => <Demo />,
};
export const Conflict: StoryObj = {
  name: 'Retained conflicting draft',
  render: () => <Demo refuse />,
};
Conflict.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(canvas.getByRole('button', { name: 'Edit' }));
  const words = page.getByRole('textbox', { name: 'Words and chords' });
  await userEvent.clear(words);
  await userEvent.type(words, 'My retained words');
  await userEvent.click(page.getByRole('button', { name: 'Save' }));
  await expect(page.getByRole('alert')).toHaveTextContent(
    'Your text has been kept',
  );
  await expect(words).toHaveValue('My retained words');
  await userEvent.click(page.getByRole('button', { name: 'Cancel' }));
};
