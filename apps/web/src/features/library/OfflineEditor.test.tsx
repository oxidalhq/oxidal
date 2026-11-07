import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  installedLv2,
  libraryCatalog,
  publishRig,
  rigDocument,
  rigLibrary,
  rigNativeSources,
  type Lv2Plugin,
  importRigResource,
} from '../../api';
import { chainLanes } from '../../rigChain';
import { lv2Effect } from '../../rigDraft';
import { buildRoute } from '../../rigRoute';
import { DeviceError } from '../../lib/friendlyError';
import { OfflineEditor } from './OfflineEditor';

// The native editor has its own tests; here it opens, then saves a copy.
vi.mock('../../NativeEditor', () => ({
  NativeEditor: ({
    open,
    onSaved,
  }: {
    open: { id: string };
    onSaved: (copy: { id: string; name: string }) => void;
  }) => (
    <div>
      <p>Editing {open.id}</p>
      <button
        type="button"
        onClick={() => onSaved({ id: 'owned-1', name: 'Amp (edited)' })}
      >
        Save edited copy
      </button>
    </div>
  ),
}));
vi.mock('../../api', () => ({
  installedLv2: vi.fn(),
  libraryCatalog: vi.fn(),
  publishRig: vi.fn(),
  rigDocument: vi.fn(),
  rigLibrary: vi.fn(),
  rigNativeSources: vi.fn(),
  importRigResource: vi.fn(),
}));

const port = (
  index: number,
  symbol: string,
  audio: boolean,
  input: boolean,
) => ({
  index,
  symbol,
  audio,
  control: !audio,
  atom: false,
  input,
  output: !input,
  integer: false,
  toggled: false,
  logarithmic: false,
  latency: false,
  minimum: audio ? null : 0,
  maximum: audio ? null : 10,
  default: audio ? null : 1,
});
const verb: Lv2Plugin = {
  name: 'Verb',
  uri: 'urn:example:verb',
  unsupported: null,
  ports: [
    port(0, 'mix', false, true),
    port(1, 'in_l', true, true),
    port(2, 'out_l', true, false),
    port(3, 'in_r', true, true),
    port(4, 'out_r', true, false),
  ],
};
const fx = (id: string) => ({ ...lv2Effect(verb), id, name: id });

function open(origin: 'mine' | 'oxidal_example' = 'mine', scenes = false) {
  const manifest = JSON.parse(
    buildRoute('preset-id', 'Two verbs', [fx('first'), fx('second')], 'prof')
      .manifest_json,
  );
  if (scenes)
    manifest.extensions['urn:oxidal:scenes:1'] = {
      scenes: [],
      branches: [{ id: 'first' }],
    };
  vi.mocked(rigDocument).mockResolvedValue({ revision: 'rev', manifest });
  vi.mocked(installedLv2).mockResolvedValue([verb]);
  vi.mocked(rigLibrary).mockResolvedValue({
    native_profile: 'prof',
    presets: [],
  } as never);
  vi.mocked(libraryCatalog).mockResolvedValue({
    items: [{ kind: 'rig', id: 'rev', origin, name: 'Two verbs' }],
  } as never);
  vi.mocked(publishRig).mockImplementation(async (request) => ({
    revision: 'next',
    manifest: JSON.parse(request.manifest_json),
  }));
  const saved = vi.fn();
  render(
    <OfflineEditor
      revision="rev"
      connected
      onSaved={saved}
      onCancel={() => {}}
    />,
  );
  return saved;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rigNativeSources).mockResolvedValue([]);
});
afterEach(cleanup);

it('edits routing and settings in a draft and publishes only on Save', async () => {
  const saved = open();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Add a parallel path beside second',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove first' }));
  fireEvent.click(screen.getByText('Settings'));
  fireEvent.change(screen.getByLabelText('second mix'), {
    target: { value: '4' },
  });
  fireEvent.change(screen.getByLabelText('Path 2 level'), {
    target: { value: '0.5' },
  });
  // Pan the dry path half right and invert it (7.26).
  fireEvent.change(screen.getByLabelText('Path 2 pan'), {
    target: { value: '0.5' },
  });
  fireEvent.click(screen.getByLabelText('Invert path 2 polarity'));
  expect(screen.getByText('Path 2 pan · 50% right')).toBeVisible();
  expect(screen.getByText('Dry · no blocks')).toBeVisible();
  expect(publishRig).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const request = vi.mocked(publishRig).mock.calls[0]![0];
  const manifest = JSON.parse(request.manifest_json);
  // Same identity: the saved revision takes the old one's place (C1).
  expect(manifest.id).toBe('preset-id');
  expect(request.source).toEqual({ kind: 'rig', id: 'rev' });
  expect(chainLanes(manifest.oxidal.graph)).toEqual([['second'], []]);
  expect(manifest.oxidal.lv2[0].controls.mix).toBe(4);
  const merge = manifest.oxidal.graph.nodes.find(
    (n: { kind: string; id: string }) =>
      n.kind === 'merge' && n.id.endsWith('-left'),
  );
  expect(merge.inputGains).toEqual([1, -0.25]);
  const right = manifest.oxidal.graph.nodes.find(
    (n: { id: string }) => n.id === merge.id.replace(/-left$/, '-right'),
  );
  expect(right.inputGains).toEqual([1, -0.5]);
});

it('saves a preset that is not yours as a copy', async () => {
  open('oxidal_example');
  expect(await screen.findByText(/as your own copy in Mine/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Move first later' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(publishRig).toHaveBeenCalled());
  const manifest = JSON.parse(
    vi.mocked(publishRig).mock.calls[0]![0].manifest_json,
  );
  expect(manifest.id).not.toBe('preset-id');
  expect(chainLanes(manifest.oxidal.graph)).toEqual([['second', 'first']]);
});

it('opens a preset without effects when effect discovery is unavailable', async () => {
  vi.mocked(rigDocument).mockResolvedValue({
    revision: 'rev',
    manifest: JSON.parse(buildRoute('id', 'Empty', [], 'prof').manifest_json),
  });
  vi.mocked(installedLv2).mockRejectedValue(
    new Error('LV2 discovery is unavailable'),
  );
  vi.mocked(rigLibrary).mockResolvedValue({
    native_profile: 'prof',
    presets: [],
  } as never);
  vi.mocked(libraryCatalog).mockResolvedValue({ items: [] } as never);
  render(
    <OfflineEditor
      revision="rev"
      connected
      onSaved={() => {}}
      onCancel={() => {}}
    />,
  );
  expect(await screen.findByText('Input straight to output.')).toBeVisible();
  expect(
    screen.getByRole('combobox', { name: 'Add a block at the end' }),
  ).toBeDisabled();
});

it('keeps the draft on a save conflict and offers the latest version', async () => {
  const refresh = vi.fn();
  const manifest = JSON.parse(
    buildRoute('id', 'Mine', [fx('first')], 'prof').manifest_json,
  );
  vi.mocked(rigDocument).mockResolvedValue({ revision: 'rev', manifest });
  vi.mocked(installedLv2).mockResolvedValue([verb]);
  vi.mocked(rigLibrary).mockResolvedValue({
    native_profile: 'prof',
    presets: [],
  } as never);
  vi.mocked(libraryCatalog).mockResolvedValue({ items: [] } as never);
  vi.mocked(publishRig).mockRejectedValue(
    new DeviceError(
      'This preset was saved again from another screen. Reopen it to see the latest version, then make your change again.',
      'conflict',
      409,
    ),
  );
  render(
    <OfflineEditor
      revision="rev"
      connected
      onSaved={() => {}}
      onCancel={() => {}}
      onRefresh={refresh}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Remove first' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not save the preset. This preset was saved again from another screen.',
  );
  expect(screen.getByText('Input straight to output.')).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Close and show the latest version' }),
  );
  expect(refresh).toHaveBeenCalledOnce();
});

it('adds a saved TONE3000 tone and keeps an existing one’s bytes', async () => {
  const user = userEvent.setup();
  const tone = (sha: string, name: string) => ({
    preset: { sha256: sha.repeat(64), size_bytes: 10, name },
    source: { kind: 'original' as const, preset: sha.repeat(64) },
  });
  const first = tone('a', 'Plexi');
  const manifest = JSON.parse(
    buildRoute(
      'id',
      'Amp',
      [{ id: 'native-a', kind: 'native', name: 'Plexi', ...first } as never],
      'prof',
    ).manifest_json,
  );
  vi.mocked(rigDocument).mockResolvedValue({ revision: 'rev', manifest });
  vi.mocked(installedLv2).mockResolvedValue([verb]);
  vi.mocked(rigNativeSources).mockResolvedValue([tone('b', 'Cab IR')] as never);
  vi.mocked(rigLibrary).mockResolvedValue({
    native_profile: 'prof',
    presets: [],
  } as never);
  vi.mocked(libraryCatalog).mockResolvedValue({ items: [] } as never);
  vi.mocked(publishRig).mockImplementation(async (request) => ({
    revision: 'next',
    manifest: JSON.parse(request.manifest_json),
  }));
  render(
    <OfflineEditor
      revision="rev"
      connected
      onSaved={() => {}}
      onCancel={() => {}}
    />,
  );
  expect(await screen.findByText('Plexi')).toBeVisible();
  await user.click(
    screen.getByRole('combobox', { name: 'Add a block at the end' }),
  );
  await user.click(screen.getByRole('option', { name: /Cab IR · TONE3000/ }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(publishRig).toHaveBeenCalled());
  const request = vi.mocked(publishRig).mock.calls[0]![0];
  const saved = JSON.parse(request.manifest_json);
  expect(saved.tone3000.instances).toHaveLength(2);
  // The kept block copies its bytes from the saved revision; the new one
  // comes from the tone library. Nothing played.
  expect(JSON.stringify(request)).toContain('"revision":"rev"');
  expect(JSON.stringify(request)).toContain('b'.repeat(64));
});

it('warns while editing when another browser saves the preset', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    open();
    await screen.findByRole('button', { name: 'Remove first' });
    vi.mocked(rigLibrary).mockResolvedValue({
      native_profile: 'prof',
      presets: [{ id: 'preset-id', revision: 'saved-elsewhere' }],
    } as never);
    await vi.advanceTimersByTimeAsync(4100);
    expect(await screen.findByText(/saved from another browser/)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Open the latest' }),
    ).toBeVisible();
    vi.mocked(rigLibrary).mockResolvedValue({
      native_profile: 'prof',
      presets: [{ id: 'preset-id', revision: 'rev' }],
    } as never);
    await vi.advanceTimersByTimeAsync(4100);
    await waitFor(() =>
      expect(screen.queryByText(/saved from another browser/)).toBeNull(),
    );
    // Taken off the set list is not an edit elsewhere.
    vi.mocked(rigLibrary).mockResolvedValue({
      native_profile: 'prof',
      presets: [],
    } as never);
    await vi.advanceTimersByTimeAsync(4100);
    expect(
      screen.queryByRole('button', { name: 'Open the latest' }),
    ).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

const amp = {
  id: 'amp',
  kind: 'native' as const,
  name: 'Amp',
  preset: { sha256: 'a'.repeat(64), size_bytes: 10, name: 'Amp' } as never,
  source: { kind: 'original' as const, preset: 'a'.repeat(64) },
};
const edited = {
  preset: { sha256: 'c'.repeat(64), size_bytes: 5, name: 'Amp (edited)' },
  source: { kind: 'owned', preset: 'owned-1' },
};
function openNative(scenes: boolean) {
  const manifest = JSON.parse(
    buildRoute('preset-id', 'Amp rig', [amp, fx('verb')], 'prof').manifest_json,
  );
  if (scenes)
    manifest.extensions['urn:oxidal:scenes:1'] = {
      scenes: [],
      branches: [{ id: 'amp' }],
    };
  vi.mocked(rigDocument).mockResolvedValue({ revision: 'rev', manifest });
  vi.mocked(installedLv2).mockResolvedValue([verb]);
  vi.mocked(rigLibrary).mockResolvedValue({
    native_profile: 'prof',
    presets: [],
  } as never);
  vi.mocked(libraryCatalog).mockResolvedValue({
    items: [{ kind: 'rig', id: 'rev', origin: 'mine', name: 'Amp rig' }],
  } as never);
  vi.mocked(importRigResource).mockResolvedValue({
    sha256: 'a'.repeat(64),
  } as never);
  vi.mocked(rigNativeSources).mockResolvedValue([edited] as never);
  vi.mocked(publishRig).mockImplementation(async (request) => ({
    revision: 'next',
    manifest: JSON.parse(request.manifest_json),
  }));
  render(
    <OfflineEditor
      revision="rev"
      connected
      onSaved={() => {}}
      onCancel={() => {}}
    />,
  );
}

it('edits a TONE3000 block’s settings without playing and saves the edited copy', async () => {
  openNative(false);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Edit Amp settings' }),
  );
  // A file kept only inside the saved preset is copied to the library first.
  await waitFor(() =>
    expect(importRigResource).toHaveBeenCalledWith('rev', expect.any(String)),
  );
  expect(await screen.findByText(`Editing ${'a'.repeat(64)}`)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save edited copy' }));
  await waitFor(() =>
    expect(screen.queryByText(/^Editing /)).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(publishRig).toHaveBeenCalled());
  const request = vi.mocked(publishRig).mock.calls.at(-1)![0];
  const manifest = JSON.parse(request.manifest_json);
  expect(manifest.resources.map((r: { sha256: string }) => r.sha256)).toEqual([
    'c'.repeat(64),
  ]);
  expect(Object.values(request.resources)).toContainEqual(edited.source);
});

it('changes block settings of a scene-chain preset and keeps its graph and scenes', async () => {
  openNative(true);
  expect(await screen.findByText(/its routing and scenes are/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Amp settings' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Save edited copy' }),
  );
  expect(await screen.findByText('Edited · not saved')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(publishRig).toHaveBeenCalled());
  const request = vi.mocked(publishRig).mock.calls.at(-1)![0];
  const manifest = JSON.parse(request.manifest_json);
  const before = JSON.parse(
    buildRoute('preset-id', 'Amp rig', [amp, fx('verb')], 'prof').manifest_json,
  );
  expect(manifest.oxidal.graph).toEqual(before.oxidal.graph);
  expect(manifest.extensions['urn:oxidal:scenes:1'].branches).toEqual([
    { id: 'amp' },
  ]);
  expect(manifest.tone3000.instances[0].preset).not.toBe(
    before.tone3000.instances[0].preset,
  );
  expect(request.resources).toMatchObject({
    [manifest.tone3000.instances[0].preset]: edited.source,
  });
});
