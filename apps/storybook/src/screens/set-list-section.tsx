import { useState } from 'react';
import { SetListEditor } from '../widgets/set-list-editor';
import {
  FRIDAY_ENTRIES,
  SET_PRESETS,
  SET_SHEETS,
  SET_TRACKS,
} from '../widgets/set-list.data';

/** Library › Set list: the set list editor with the fixture set. */
export function SetListSection() {
  const [entries, setEntries] = useState(FRIDAY_ENTRIES);
  return (
    <SetListEditor
      name="Friday set"
      entries={entries}
      onChange={setEntries}
      presets={SET_PRESETS}
      tracks={SET_TRACKS}
      sheets={SET_SHEETS}
      onPlay={() => {}}
      onPlayFrom={() => {}}
    />
  );
}
