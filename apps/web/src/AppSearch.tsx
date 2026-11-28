import {
  ChartLine,
  Gear,
  Guitar,
  ListNumbers,
  MusicNote,
  Stack,
  Waveform,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';

import type { Destination } from '@oxidal/design-system/patterns/app-shell';
import {
  CommandSearch,
  type SearchGroup,
} from '@oxidal/design-system/widgets/command-search';

import { useCommands, usePresetChooser } from './commandStore';
import {
  choiceKey,
  choiceSource,
  choiceSummary,
  loadPresetChoices,
  type PresetChoice,
} from './presetChoices';

const SCREENS: {
  id: Destination;
  label: string;
  hint: string;
  icon: React.ReactNode;
}[] = [
  { id: 'rig', label: 'Rig', hint: 'Shape the sound', icon: <Waveform /> },
  {
    id: 'guitars',
    label: 'Guitars',
    hint: 'Guitars and pickups',
    icon: <Guitar />,
  },
  {
    id: 'library',
    label: 'Library',
    hint: 'Presets, set lists, stems',
    icon: <Stack />,
  },
  {
    id: 'levels',
    label: 'Levels',
    hint: 'Sound check and readings',
    icon: <ChartLine />,
  },
  {
    id: 'settings',
    label: 'Settings',
    hint: 'Audio, MIDI, network',
    icon: <Gear />,
  },
];

/**
 * The one search: screens, the presets and set list the Library shows, and
 * whatever the showing screen offers (the Rig's scenes). Choosing a preset
 * uses the Rig's own way of playing one, so its unsaved-edit checks apply.
 * @see docs/interface.md
 */
export function AppSearch({
  open,
  onOpenChange,
  onNavigate,
  onTuner,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (destination: Destination) => void;
  onTuner: () => void;
}) {
  const commands = useCommands();
  const choose = usePresetChooser();
  const [items, setItems] = useState<PresetChoice[]>([]);
  useEffect(() => {
    if (!open || !choose) return;
    let live = true;
    void loadPresetChoices().then(
      (loaded) => live && setItems(loaded.items),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [open, choose]);

  const groups = useMemo<SearchGroup[]>(() => {
    const out: SearchGroup[] = [];
    const byGroup = new Map<string, SearchGroup>();
    for (const c of commands) {
      let g = byGroup.get(c.group);
      if (!g) {
        g = { title: c.group, items: [] };
        byGroup.set(c.group, g);
        out.push(g);
      }
      g.items.push({
        id: c.id,
        label: c.label,
        hint: c.hint,
        keywords: c.keywords,
        onChoose: c.run,
      });
    }
    if (choose) {
      const row = (c: PresetChoice, n?: number) => ({
        id: `preset:${c.kind === 'scenes' ? choiceKey({ kind: 'scenes', revision: c.revision }) : choiceKey({ kind: 'tone3000', id: c.id, owned: c.owned })}${n ? `#${n}` : ''}`,
        label: c.name,
        hint: n ? `Set list ${n}` : `${choiceSource(c)} · ${choiceSummary(c)}`,
        icon: n ? <ListNumbers /> : <MusicNote />,
        onChoose: () => choose(c),
      });
      const setList = items.filter((c) => c.inSetList);
      if (setList.length)
        out.push({
          title: 'Set list',
          items: setList.map((c, i) => row(c, i + 1)),
        });
      out.push({ title: 'Presets', items: items.map((c) => row(c)) });
    }
    out.push({
      title: 'Screens and actions',
      items: [
        ...SCREENS.map((s) => ({
          id: `screen:${s.id}`,
          label: s.label,
          hint: s.hint,
          icon: s.icon,
          onChoose: () => onNavigate(s.id),
        })),
        {
          id: 'action:tuner',
          label: 'Tuner',
          hint: 'Open the tuner',
          icon: <MusicNote />,
          onChoose: onTuner,
        },
      ],
    });
    return out;
  }, [commands, choose, items, onNavigate, onTuner]);

  return (
    <CommandSearch open={open} onOpenChange={onOpenChange} groups={groups} />
  );
}
