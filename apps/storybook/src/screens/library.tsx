import { useState } from 'react';
import {
  ArrowsClockwise,
  DownloadSimple,
  FilePlus,
  ListPlus,
  MusicNotes,
  Microphone,
  PencilSimple,
  Play,
  Plus,
  Queue,
  Scissors,
  SlidersHorizontal,
  Copy,
  Trash,
} from '@phosphor-icons/react';
import { Button } from '../components/ui/button';
import { useConfirm } from '../components/ui/confirm';
import { PageHeading } from '../patterns/app-shell';
import { LibraryList, type LibraryItem } from '../patterns/library-list';
import { ModelBrowser } from '../patterns/model-browser';
import { StemWorkspaceDemo } from '../patterns/stem-workspace.demo';
import { useModelDownloads } from '../patterns/swap.demo';
import { MODELS } from '../patterns/swap.fixtures';
import { Workspace } from '../patterns/workspace';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
} from '../components/ui/sheet';
import { LIBRARY_SECTIONS } from './library.sections';
import { Songbook } from './songbook';
import { SetListSection } from './set-list-section';
import {
  DI,
  PRESETS,
  STARTING_FAVOURITES,
  STEM_SONGS,
  TONES,
  TRACKS,
  withUsage,
} from './fixtures';
import { SoundBrowser } from '../patterns/sound-browser';
import { SOUNDS as OXIDAL_SOUNDS } from '../patterns/sound-browser.data';

/** Library › TONE3000: the same search the rig's Change sheet uses. */
function Tone3000Section() {
  const store = useModelDownloads(MODELS);
  const [playing, setPlaying] = useState<string | null>(null);
  return (
    <ModelBrowser
      models={store.models}
      only="tone3000"
      beside
      playing={playing}
      downloads={store.downloads}
      catalogue={store.catalogue}
      onTry={(m) => setPlaying(m.id)}
      onGet={store.onGet}
    />
  );
}

/**
 * Library: eight sections in one workspace, each built the way Oxidal sounds
 * is. Every row says what it is and its status and carries the one action
 * people come for; everything else sits in the details beside the list.
 */
export function Library({ section: initial = 'mine' }: { section?: string }) {
  const [section, setSection] = useState(initial);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'artwork'>('list');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>('p1');
  const [mixing, setMixing] = useState<string | null>(null);
  const [favourites, setFavourites] = useState(STARTING_FAVOURITES);
  const favourite = (id: string, on: boolean) =>
    setFavourites((all) => {
      const next = new Set(all);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const use = (items: LibraryItem[]) => withUsage(items, favourites);
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
  const common = {
    query,
    onQuery: setQuery,
    selected,
    onOpen: setSelected,
    onFavourite: favourite,
  };
  const byKind = (items: LibraryItem[]) =>
    filter === 'all' ? items : items.filter((i) => i.kind === filter);
  return (
    <>
      <PageHeading
        eyebrow="Library"
        title={
          LIBRARY_SECTIONS.find((s) => s.id === section)?.label ?? 'Library'
        }
        caption={LIBRARY_SECTIONS.find((s) => s.id === section)?.description}
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
            items={use(PRESETS)}
            view={view}
            onView={setView}
            noun={['preset', 'presets']}
            primary={
              <Button>
                <Plus /> New preset
              </Button>
            }
            empty={{
              title: 'No presets yet',
              text: 'Create one with New preset, or start from Oxidal sounds.',
            }}
            mainAction={(item) =>
              item.badge?.text === 'Playing'
                ? null
                : { label: 'Load', icon: <Play />, run: () => {} }
            }
            actions={[
              { label: 'Add to set list', icon: <ListPlus />, run: () => {} },
              { label: 'Duplicate', icon: <Copy />, run: () => {} },
              { label: 'Rename', icon: <PencilSimple />, run: () => {} },
              { label: 'Download', icon: <DownloadSimple />, run: () => {} },
              {
                label: 'Delete…',
                icon: <Trash />,
                destructive: true,
                run: remove(PRESETS),
              },
            ]}
          />
        )}
        {section === 'oxidal' && (
          <SoundBrowser
            sounds={OXIDAL_SOUNDS}
            status={{ state: 'ready' }}
            onTry={() => {}}
            onSaveCopy={() => {}}
            onAddToSetList={() => {}}
            onGetTone={() => {}}
            onInstallPack={() => {}}
            onRetry={() => {}}
          />
        )}
        {section === 'tone3000' && <Tone3000Section />}
        {section === 'setlist' && <SetListSection />}
        {section === 'songbook' && <Songbook />}
        {section === 'tones' && (
          <LibraryList
            {...common}
            items={use(byKind(TONES))}
            noun={['tone', 'tones']}
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
            mainAction={() => ({
              label: 'Try',
              icon: <Play />,
              run: () => {},
            })}
            actions={[
              { label: 'Use in the rig', icon: <Plus />, run: () => {} },
              { label: 'Rename', icon: <PencilSimple />, run: () => {} },
              {
                label: 'Delete…',
                icon: <Trash />,
                destructive: true,
                run: remove(TONES),
              },
            ]}
          />
        )}
        {section === 'backing' && (
          <LibraryList
            {...common}
            items={use(TRACKS)}
            onPlay={() => {}}
            tile={<MusicNotes />}
            noun={['track', 'tracks']}
            primary={
              <Button variant="outline">
                <FilePlus /> Import…
              </Button>
            }
            empty={{
              title: 'No backing tracks yet',
              text: 'Import a WAV or MP3 to play over your rig.',
            }}
            mainAction={(item) =>
              item.playable
                ? { label: 'Cue', icon: <Queue />, run: () => {} }
                : null
            }
            actions={[
              {
                label: 'Open mixer',
                icon: <SlidersHorizontal />,
                run: setMixing,
              },
              { label: 'Split into stems…', icon: <Scissors />, run: () => {} },
              { label: 'Rename', icon: <PencilSimple />, run: () => {} },
              {
                label: 'Delete…',
                icon: <Trash />,
                destructive: true,
                run: remove(TRACKS),
              },
            ]}
          />
        )}
        {section === 'stems' && (
          <LibraryList
            {...common}
            items={use(STEM_SONGS)}
            onPlay={() => {}}
            tile={<SlidersHorizontal />}
            noun={['song', 'songs']}
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
            mainAction={() => ({
              label: 'Open mixer',
              icon: <SlidersHorizontal />,
              run: setMixing,
            })}
            actions={[
              {
                label: 'Download stems',
                icon: <DownloadSimple />,
                run: () => {},
              },
              {
                label: 'Delete…',
                icon: <Trash />,
                destructive: true,
                run: remove(STEM_SONGS),
              },
            ]}
          />
        )}
        {section === 'di' && (
          <LibraryList
            {...common}
            items={use(DI)}
            onPlay={() => {}}
            tile={<Microphone />}
            noun={['recording', 'recordings']}
            primary={
              <Button>
                <Microphone /> Record DI
              </Button>
            }
            empty={{
              title: 'No DI recordings yet',
              text: 'Record your dry guitar and play it back through any rig.',
            }}
            mainAction={() => ({
              label: 'Reamp',
              icon: <ArrowsClockwise />,
              run: () => {},
            })}
            actions={[
              { label: 'Download', icon: <DownloadSimple />, run: () => {} },
              {
                label: 'Delete…',
                icon: <Trash />,
                destructive: true,
                run: remove(DI),
              },
            ]}
          />
        )}
      </Workspace>
      {dialog}
      <Sheet open={Boolean(mixing)} onOpenChange={(o) => !o && setMixing(null)}>
        <SheetContent
          onOpenChange={(o) => !o && setMixing(null)}
          className="md:w-[min(44rem,100vw)]"
        >
          <SheetHeader
            title="Stem mixer"
            description="Shape the mix while it plays, then save it as a backing track."
          />
          <SheetBody>{mixing && <StemWorkspaceDemo />}</SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
