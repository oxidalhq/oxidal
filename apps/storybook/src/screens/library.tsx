import { useState } from 'react';
import { FilePlus, Microphone, Plus, Scissors } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Caption } from '@/components/ui/text';
import { PageHeading } from '@/patterns/app-shell';
import { PoweredByTone3000 } from '@/patterns/credits';
import { LibraryList, type LibraryItem } from '@/patterns/library-list';
import { Workspace } from '@/patterns/workspace';
import { LIBRARY_SECTIONS } from './library.sections';
import {
  DI,
  PRESETS,
  SETLIST,
  SOUNDS,
  STEM_SONGS,
  TONES,
  TRACKS,
} from './fixtures';

/**
 * Library: eight sections in one workspace, each a LibraryList with its
 * own way in (New preset, Import…, Split a track…) and its own row
 * actions. Catalogue tones carry the TONE3000 line.
 */
export function Library({ section: initial = 'mine' }: { section?: string }) {
  const [section, setSection] = useState(initial);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'artwork'>('list');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>('p1');
  const { ask, dialog } = useConfirm();
  const remove = (items: LibraryItem[]) => async (id: string) => {
    const item = items.find((i) => i.id === id);
    await ask({
      title: `Delete “${item?.title}”?`,
      body: 'This cannot be undone.',
      confirm: 'Delete',
      destructive: true,
    });
  };
  const common = { query, onQuery: setQuery, selected, onOpen: setSelected };
  const byKind = (items: LibraryItem[]) =>
    filter === 'all' ? items : items.filter((i) => i.kind === filter);
  return (
    <>
      <PageHeading
        eyebrow="Library"
        title={
          LIBRARY_SECTIONS.find((s) => s.id === section)?.label ?? 'Library'
        }
      />
      <Workspace
        sections={LIBRARY_SECTIONS}
        value={section}
        onChange={(id) => {
          setSection(id);
          setQuery('');
        }}
        label="Library sections"
      >
        {section === 'mine' && (
          <LibraryList
            {...common}
            items={PRESETS}
            view={view}
            onView={setView}
            primary={
              <Button>
                <Plus /> New preset
              </Button>
            }
            empty={{
              title: 'No presets yet',
              text: 'Create one with New preset, or start from Oxidal sounds.',
            }}
            actions={[
              { label: 'Rename', run: () => {} },
              { label: 'Duplicate', run: () => {} },
              { label: 'Add to set list', run: () => {} },
              { label: 'Download', run: () => {} },
              { label: 'Delete…', destructive: true, run: remove(PRESETS) },
            ]}
          />
        )}
        {section === 'oxidal' && (
          <LibraryList
            {...common}
            items={SOUNDS}
            view={view}
            onView={setView}
            filters={[
              { id: 'all', label: 'All' },
              { id: 'rock', label: 'Rock' },
              { id: 'clean', label: 'Clean' },
              { id: 'metal', label: 'Metal' },
              { id: 'bass', label: 'Bass' },
            ]}
            filter={filter}
            onFilter={setFilter}
            empty={{ title: 'No sounds' }}
            actions={[
              { label: 'Save a copy to Mine', run: () => {} },
              { label: 'Add to set list', run: () => {} },
            ]}
          />
        )}
        {section === 'tone3000' && (
          <div className="grid gap-3">
            <Caption>
              Search the catalogue, audition a tone through your rig and keep
              the ones you like. Each tone shows its creator and licence.
            </Caption>
            <LibraryList
              {...common}
              items={TONES.map((t) => ({ ...t, badge: undefined }))}
              filters={[
                { id: 'all', label: 'All' },
                { id: 'amp', label: 'Amps' },
                { id: 'cab', label: 'Cabs' },
                { id: 'pedal', label: 'Pedals' },
              ]}
              filter={filter}
              onFilter={setFilter}
              empty={{ title: 'Nothing found on TONE3000' }}
              actions={[
                { label: 'Audition', run: () => {} },
                { label: 'Keep', run: () => {} },
              ]}
            />
            <PoweredByTone3000 />
          </div>
        )}
        {section === 'setlist' && (
          <LibraryList
            {...common}
            items={SETLIST}
            primary={
              <Button variant="outline">
                <Plus /> Add preset
              </Button>
            }
            empty={{
              title: 'The set list is empty',
              text: 'Add presets from Mine or Oxidal sounds; drag to order them.',
            }}
            actions={[
              { label: 'Choose backing track', run: () => {} },
              { label: 'Move up', run: () => {} },
              { label: 'Move down', run: () => {} },
              {
                label: 'Remove from set list',
                destructive: true,
                run: () => {},
              },
            ]}
          />
        )}
        {section === 'tones' && (
          <LibraryList
            {...common}
            items={byKind(TONES)}
            filters={[
              { id: 'all', label: 'All' },
              { id: 'amp', label: 'Amps' },
              { id: 'cab', label: 'IRs' },
              { id: 'pedal', label: 'Pedals' },
            ]}
            filter={filter}
            onFilter={setFilter}
            primary={
              <Button variant="outline">
                <FilePlus /> Import…
              </Button>
            }
            empty={{
              title: 'No tones or IRs yet',
              text: 'Import .nam and .wav files, or keep tones from TONE3000.',
            }}
            actions={[
              { label: 'Audition', run: () => {} },
              { label: 'Use in the rig', run: () => {} },
              { label: 'Rename', run: () => {} },
              { label: 'Delete…', destructive: true, run: remove(TONES) },
            ]}
          />
        )}
        {section === 'backing' && (
          <LibraryList
            {...common}
            items={TRACKS}
            onPlay={() => {}}
            primary={
              <Button variant="outline">
                <FilePlus /> Import…
              </Button>
            }
            empty={{
              title: 'No backing tracks yet',
              text: 'Import a WAV or MP3 to play over your rig.',
            }}
            actions={[
              { label: 'Cue', run: () => {} },
              { label: 'Split into stems…', run: () => {} },
              { label: 'Rename', run: () => {} },
              { label: 'Delete…', destructive: true, run: remove(TRACKS) },
            ]}
          />
        )}
        {section === 'stems' && (
          <LibraryList
            {...common}
            items={STEM_SONGS}
            onPlay={() => {}}
            primary={
              <>
                <Button>
                  <Scissors /> Split a track…
                </Button>
                <Button variant="outline">
                  <FilePlus /> Import stems…
                </Button>
              </>
            }
            empty={{
              title: 'No songs with stems yet',
              text: 'Split one of your backing tracks, or import stems exported from another app.',
            }}
            actions={[
              { label: 'Open mixer', run: () => {} },
              { label: 'Download stems', run: () => {} },
              { label: 'Delete…', destructive: true, run: remove(STEM_SONGS) },
            ]}
          />
        )}
        {section === 'di' && (
          <LibraryList
            {...common}
            items={DI}
            onPlay={() => {}}
            primary={
              <Button>
                <Microphone /> Record DI
              </Button>
            }
            empty={{
              title: 'No DI recordings yet',
              text: 'Record your dry guitar and play it back through any rig.',
            }}
            actions={[
              { label: 'Reamp through…', run: () => {} },
              { label: 'Download', run: () => {} },
              { label: 'Delete…', destructive: true, run: remove(DI) },
            ]}
          />
        )}
      </Workspace>
      {dialog}
    </>
  );
}
