import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  changeEffectPack,
  downloadVoice,
  effectPacks,
  installedLv2,
  libraryCatalog,
  presetDetails,
  protectState,
  publishRig,
  rigAudioState,
  rigDocument,
  rigLibrary,
  tone3000Account,
  tone3000Models,
  tone3000Tone,
  voiceCaptures,
} from '../../../api';
import catalog from '../../../fixtures/factory-lv2.json';
import type { RigNativeSource } from '../../../generated/contract';
import { DeviceError } from '../../../lib/friendlyError';
import { playScenes } from '../../../presetChoices';
import { OxidalSounds } from './index';

/** @see docs/factory-collection.md */
vi.mock('../../../api', () => ({
  installedLv2: vi.fn(),
  nativeDefaults: vi.fn(async () => ({
    revision: 'defaults-1',
    settings: { nam_size: 1, multi_core: true, parameters: {} },
  })),
  rigNativeSources: vi.fn(async () => []),
  rigLibrary: vi.fn(),
  rigDocument: vi.fn(),
  publishRig: vi.fn(),
  presetDetails: vi.fn(),
  voiceCaptures: vi.fn(),
  tone3000Tone: vi.fn(),
  tone3000Models: vi.fn(),
  downloadVoice: vi.fn(),
  effectPacks: vi.fn(),
  changeEffectPack: vi.fn(),
  protectState: vi.fn(),
  tone3000Account: vi.fn(),
  rigAudioState: vi.fn(),
  libraryCatalog: vi.fn(async (update?: { id?: string }) => ({
    revision: 'c1',
    starter_offered: false,
    items: update?.id
      ? [
          {
            kind: 'rig',
            id: update.id,
            name: 'Brown Crunch',
            source_name: 'Brown Crunch',
            archived: false,
            origin: 'oxidal_example',
            in_set_list: true,
          },
        ]
      : [],
  })),
}));
vi.mock('../../../presetChoices', () => ({ playScenes: vi.fn() }));

const source: RigNativeSource = {
  preset: {
    sha256: 'b'.repeat(64),
    name: 'Downloaded capture',
    size_bytes: 100,
    framing: 'current',
    block_count: 1,
    embedded_bytes: 20,
    parameter_count: 1,
    playback_available: true,
  },
  source: { kind: 'owned', preset: 'owned-voice-1' },
};
const tone = {
  id: 65578,
  title: 'Plexi test capture',
  user: { username: 'maker', display_name: null },
  gear: 'amp-cab',
  format: 'nam',
  license: 'cc-by',
  images: null,
  url: 'https://example.invalid/tone',
  models_count: 1,
  a1_models_count: 0,
  a2_models_count: 1,
  custom_models_count: 0,
};
const pack = (id: string, installed: boolean) => ({
  id,
  installed,
  name: id.toUpperCase(),
  package: id,
  qualification: 'qualified',
  size_mib: 4,
  usable_plugins: 3,
  website: 'https://example.invalid',
});
const entry = (name: string, revision: string, origin = 'oxidal_example') => ({
  id: revision,
  name,
  revision,
  origin,
  lv2_instances: 1,
  native_instances: 1,
  topology: 'scenes' as const,
  scenes: ['Rhythm', 'Lead', 'Intro'],
});
const BROWN = 'Brown Crunch';
const notFound = () => new DeviceError('Not found', 'not_found', 404);

beforeEach(() => {
  vi.mocked(installedLv2).mockResolvedValue(catalog as never);
  vi.mocked(rigLibrary).mockResolvedValue({
    native_profile: 'profile',
    presets: [],
    next: null,
  } as never);
  vi.mocked(presetDetails).mockResolvedValue({
    revision: 'details-1',
    entries: [],
  });
  vi.mocked(voiceCaptures).mockResolvedValue({ captures: [], downloaded: [] });
  vi.mocked(effectPacks).mockResolvedValue({
    audio_running: false,
    available: true,
    message: '',
    packs: [pack('calf', false), pack('guitarix', true)],
    storage_writable: true,
  });
  vi.mocked(protectState).mockResolvedValue({ on: false });
  vi.mocked(tone3000Account).mockResolvedValue({
    phase: 'connected',
    revision: 1,
    session: 's',
  });
  vi.mocked(rigAudioState).mockResolvedValue({
    configured: null,
    phase: 'stopped',
  } as never);
  vi.mocked(tone3000Tone).mockResolvedValue(tone);
  vi.mocked(tone3000Models).mockResolvedValue({
    data: [
      {
        id: 418470,
        name: 'A2',
        size: '18 MB',
        tone_id: 65578,
        architecture_version: '2',
      },
    ],
    page: 1,
    total_pages: 1,
  });
  vi.mocked(publishRig).mockResolvedValue({
    revision: 'a'.repeat(64),
  } as never);
  vi.mocked(playScenes).mockResolvedValue(undefined);
  window.location.hash = '#library/oxidal';
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openBrown(onOpenRig = () => {}, onChanged = () => {}) {
  const user = userEvent.setup();
  render(
    <OxidalSounds connected onChanged={onChanged} onOpenRig={onOpenRig} />,
  );
  const search = await screen.findByRole('searchbox', {
    name: 'Search Oxidal sounds',
  });
  await user.click(search);
  await user.paste(BROWN);
  const card = await screen.findByRole('article', { name: BROWN });
  await waitFor(() =>
    expect(card).not.toHaveAttribute('data-state', 'loading'),
  );
  return { user, card };
}

it('Ready: one Play action that plays the built example and opens the rig', async () => {
  vi.mocked(rigLibrary).mockResolvedValue({
    native_profile: 'profile',
    presets: [entry(BROWN, 'r1')],
    next: null,
  } as never);
  const open = vi.fn();
  const { user, card } = await openBrown(open);
  expect(card).toHaveAttribute('data-state', 'ready');
  expect(within(card).getAllByRole('button')).toHaveLength(2);
  await user.click(
    within(card).getByRole('button', { name: `Play: ${BROWN}` }),
  );
  await waitFor(() => expect(playScenes).toHaveBeenCalledWith('r1'));
  expect(open).toHaveBeenCalled();
  expect(publishRig).not.toHaveBeenCalled();
});

it('Complete: a sound with everything installed is saved with its metadata on Play, with no separate step', async () => {
  vi.mocked(voiceCaptures).mockResolvedValue({
    captures: [{ tone_id: 65578, model_id: 418470, source }],
    downloaded: [],
  });
  const changed = vi.fn();
  const { user, card } = await openBrown(() => {}, changed);
  expect(card).toHaveAttribute('data-state', 'build');
  expect(within(card).getByText('Everything is installed.')).toBeVisible();
  await user.click(
    within(card).getByRole('button', { name: `Play: ${BROWN}` }),
  );
  await waitFor(() => expect(publishRig).toHaveBeenCalledOnce());
  await waitFor(() => expect(playScenes).toHaveBeenCalledWith('a'.repeat(64)));
  expect(screen.queryByRole('button', { name: /Build/ })).toBeNull();
  expect(presetDetails).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'a'.repeat(64),
      metadata: expect.objectContaining({ engine: 'hybrid' }),
    }),
  );
  expect(changed).toHaveBeenCalled();
});

it('Get tones: lists the missing tone with its size, downloads, builds, then Play', async () => {
  vi.mocked(downloadVoice).mockResolvedValue({
    downloaded: true,
    capture: { tone_id: 65578, model_id: 418470, source },
  });
  const { user, card } = await openBrown();
  expect(card).toHaveAttribute('data-state', 'tone');
  await user.click(
    within(card).getByRole('button', { name: `Get tones: ${BROWN}` }),
  );
  const dialog = await screen.findByRole('dialog');
  const link = await within(dialog).findByRole('link', {
    name: 'Plexi test capture',
  });
  expect(link).toHaveAttribute('href', 'https://www.tone3000.com/tones/65578');
  expect(link).toHaveAttribute('target', '_blank');
  expect(within(dialog).getByText(/· by maker/)).toBeVisible();
  expect(within(dialog).getByText('Model: A2 (418470) · 18 MB')).toBeVisible();
  expect(within(dialog).getByText(/^For: /)).toBeVisible();
  expect(within(dialog).getByText('On this unit: 0 of 1')).toBeVisible();
  expect(downloadVoice).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Download' }));
  await within(dialog).findByText('Ready.');
  expect(downloadVoice).toHaveBeenCalledExactlyOnceWith(
    65578,
    418470,
    'Plexi test capture',
  );
  expect(publishRig).toHaveBeenCalledOnce();
  await user.click(within(dialog).getByRole('button', { name: 'Play' }));
  await waitFor(() => expect(playScenes).toHaveBeenCalledWith('a'.repeat(64)));
});

it('a tone removed from TONE3000 fails cleanly, names it and offers another tone', async () => {
  vi.mocked(downloadVoice).mockRejectedValue(new Error('gone'));
  const { user, card } = await openBrown();
  await user.click(
    within(card).getByRole('button', { name: `Get tones: ${BROWN}` }),
  );
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText(/Plexi test capture/);
  // The tone disappears between listing and downloading.
  vi.mocked(tone3000Tone).mockRejectedValue(notFound());
  await user.click(within(dialog).getByRole('button', { name: 'Download' }));
  expect(
    await within(dialog).findByText(
      /"Plexi test capture" was removed from TONE3000\./,
    ),
  ).toBeVisible();
  expect(publishRig).not.toHaveBeenCalled();
  expect(
    within(dialog).getByRole('button', { name: 'Choose another tone…' }),
  ).toBeVisible();
});

it('a tone already removed when the dialog opens blocks the download', async () => {
  vi.mocked(tone3000Tone).mockRejectedValue(notFound());
  const { user, card } = await openBrown();
  await user.click(
    within(card).getByRole('button', { name: `Get tones: ${BROWN}` }),
  );
  const dialog = await screen.findByRole('dialog');
  expect(
    await within(dialog).findByText(/removed from TONE3000/i),
  ).toBeVisible();
  expect(
    within(dialog).getByRole('button', { name: 'Download' }),
  ).toBeDisabled();
  await user.click(
    within(dialog).getByRole('button', { name: 'Choose another tone…' }),
  );
  expect(
    within(dialog).getByText(/Pick one with a similar sound/),
  ).toBeVisible();
});

it('a tone that cannot be read says why, with the device words under Details', async () => {
  vi.mocked(tone3000Tone).mockRejectedValue(
    new DeviceError(
      'TONE3000 answered 503 Service Unavailable',
      'unavailable',
      502,
    ),
  );
  const { user, card } = await openBrown();
  await user.click(
    within(card).getByRole('button', { name: `Get tones: ${BROWN}` }),
  );
  const dialog = await screen.findByRole('dialog');
  const alert = await within(dialog).findByRole('alert');
  expect(alert).toHaveTextContent(
    'Could not read TONE3000. TONE3000 answered 503 Service Unavailable.',
  );
  expect(
    within(dialog).getByText(
      'HTTP 502 · unavailable · TONE3000 answered 503 Service Unavailable',
    ),
  ).toBeInTheDocument();
  // The sound names its model, so the download itself can still be tried.
  expect(
    within(dialog).getByRole('button', { name: 'Download' }),
  ).toBeEnabled();
});

it('a tone already downloaded in Tones and IRs is added without TONE3000, even signed out', async () => {
  vi.mocked(voiceCaptures).mockResolvedValue({
    captures: [],
    downloaded: [{ tone_id: 65578, model_id: 418470 }],
  });
  vi.mocked(tone3000Account).mockResolvedValue({
    phase: 'signed_out',
    revision: 1,
    session: 's',
  } as never);
  vi.mocked(tone3000Tone).mockRejectedValue(new Error('offline'));
  vi.mocked(downloadVoice).mockResolvedValue({
    downloaded: false,
    capture: { tone_id: 65578, model_id: 418470, source },
  });
  const { user, card } = await openBrown();
  expect(card).toHaveTextContent(/tones are downloaded on this unit/);
  await user.click(
    within(card).getByRole('button', { name: `Add tones: ${BROWN}` }),
  );
  const dialog = await screen.findByRole('dialog');
  expect(
    await within(dialog).findByText('Already downloaded in Tones and IRs'),
  ).toBeVisible();
  // A failed TONE3000 read does not block a tone that is already here.
  expect(within(dialog).queryByRole('alert')).toBeNull();
  await user.click(within(dialog).getByRole('button', { name: 'Download' }));
  await within(dialog).findByText('Ready.');
  expect(downloadVoice).toHaveBeenCalledWith(65578, 418470, expect.any(String));
});

it('each tone downloads on its own and a failed one can be tried again', async () => {
  vi.mocked(downloadVoice)
    .mockRejectedValueOnce(
      new DeviceError(
        'TONE3000 is unavailable (HTTP 503); retry shortly',
        'unavailable',
        502,
      ),
    )
    .mockResolvedValueOnce({
      downloaded: true,
      capture: { tone_id: 65578, model_id: 418470, source },
    });
  const { user, card } = await openBrown();
  await user.click(
    within(card).getByRole('button', { name: `Get tones: ${BROWN}` }),
  );
  const dialog = await screen.findByRole('dialog');
  const row = await within(dialog).findByRole('button', {
    name: /^Download: /,
  });
  await waitFor(() => expect(row).toBeEnabled());
  await user.click(row);
  expect(
    (
      await within(dialog).findAllByText(/TONE3000 is unavailable \(HTTP 503\)/)
    )[0],
  ).toBeVisible();
  expect(publishRig).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: /^Download: / }));
  await within(dialog).findByText('Ready.');
  expect(publishRig).toHaveBeenCalledOnce();
});

it('Sign in: signed out offers sign-in first; after sign-in the same Get tones dialog returns', async () => {
  vi.mocked(tone3000Account).mockResolvedValue({
    phase: 'disconnected',
    revision: 1,
    session: 's',
  });
  const { user, card } = await openBrown();
  expect(card).toHaveAttribute('data-state', 'signed-out');
  expect(within(card).queryByRole('button', { name: /Get tones/ })).toBeNull();
  await user.click(
    within(card).getByRole('button', { name: `Sign in to TONE3000: ${BROWN}` }),
  );
  expect(window.location.hash).toBe('#settings/accounts');
  cleanup();
  // Back from the Accounts page, signed in.
  vi.mocked(tone3000Account).mockResolvedValue({
    phase: 'connected',
    revision: 2,
    session: 's',
  });
  render(<OxidalSounds connected onChanged={() => {}} />);
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByRole('heading', { name: `Get tones for ${BROWN}` }),
  ).toBeVisible();
});

it('Install pack: missing pack is the one action; Protect disables it with the reason', async () => {
  vi.mocked(installedLv2).mockResolvedValue([]);
  vi.mocked(changeEffectPack).mockImplementation(async (id) => ({
    audio_running: false,
    available: true,
    message: '',
    packs: [pack(id, true)],
    storage_writable: true,
  }));
  const { user, card } = await openBrown();
  expect(card).toHaveAttribute('data-state', 'pack');
  const install = within(card).getByRole('button', {
    name: `Install pack: ${BROWN}`,
  });
  expect(install).toBeEnabled();
  expect(
    within(card).queryByRole('button', { name: /Get tones|Build/ }),
  ).toBeNull();
  await user.click(install);
  await waitFor(() =>
    expect(changeEffectPack).toHaveBeenCalledWith('guitarix', 'install'),
  );
});

it('a pack that did not install says why and never claims success', async () => {
  vi.mocked(installedLv2).mockResolvedValue([]);
  vi.mocked(changeEffectPack).mockImplementation(async (id) => ({
    audio_running: false,
    available: true,
    message: 'The package server could not be reached.',
    packs: [pack(id, false)],
    storage_writable: true,
  }));
  const { user, card } = await openBrown();
  await user.click(
    within(card).getByRole('button', { name: `Install pack: ${BROWN}` }),
  );
  expect(
    await screen.findByText(/package server could not be reached/),
  ).toBeVisible();
  expect(screen.queryByText(/Installed\./)).toBeNull();
  expect(publishRig).not.toHaveBeenCalled();
});

it('an installed pack saves the sounds it completes, with no Build step', async () => {
  vi.mocked(voiceCaptures).mockResolvedValue({
    captures: [{ tone_id: 65578, model_id: 418470, source }],
    downloaded: [],
  });
  vi.mocked(installedLv2).mockResolvedValueOnce([]);
  vi.mocked(changeEffectPack).mockImplementation(async (id) => ({
    audio_running: false,
    available: true,
    message: '',
    packs: [pack(id, true)],
    storage_writable: true,
  }));
  const { user, card } = await openBrown();
  expect(card).toHaveAttribute('data-state', 'pack');
  // A slow follow-up inventory must not keep a confirmed install looking missing.
  vi.mocked(rigLibrary).mockImplementation(() => new Promise(() => {}));
  await user.click(
    within(card).getByRole('button', { name: `Install pack: ${BROWN}` }),
  );
  await waitFor(() => expect(publishRig).toHaveBeenCalled());
  await waitFor(() => expect(card).toHaveAttribute('data-state', 'ready'));
  expect(
    within(card).getByRole('button', { name: `Play: ${BROWN}` }),
  ).toBeEnabled();
  expect(
    vi
      .mocked(presetDetails)
      .mock.calls.some(([update]) => update?.description !== undefined),
  ).toBe(true);
});

it('with Protect on, Install pack is disabled and says why', async () => {
  vi.mocked(installedLv2).mockResolvedValue([]);
  vi.mocked(protectState).mockResolvedValue({ on: true });
  const { card } = await openBrown();
  expect(
    within(card).getByRole('button', { name: `Install pack: ${BROWN}` }),
  ).toBeDisabled();
  expect(
    within(card).getByText(/Protect is on, so packs cannot be installed/),
  ).toBeVisible();
  expect(changeEffectPack).not.toHaveBeenCalled();
});

it('Too heavy shows the reason and the buffer that fits, with no Play or Build', async () => {
  vi.mocked(rigAudioState).mockResolvedValue({
    configured: { stream: { input: { period_frames: 16 } } },
    phase: 'running',
  } as never);
  const { card } = await openBrown();
  expect(card).toHaveAttribute('data-state', 'heavy');
  expect(
    within(card).getByText(/captures?; your stream fits 0\./),
  ).toBeVisible();
  expect(within(card).getByText(/Fits at a \d+-frame buffer/)).toBeVisible();
  expect(
    within(card).queryByRole('button', { name: /Play|Build|Get tones/ }),
  ).toBeNull();
  expect(
    within(card).getByRole('button', { name: `Details: ${BROWN}` }),
  ).toBeVisible();
});

it('Details: one sheet with scenes, chain, needs and load; Make my copy leaves the original unchanged', async () => {
  vi.mocked(rigLibrary).mockResolvedValue({
    native_profile: 'profile',
    presets: [entry(BROWN, 'r1')],
    next: null,
  } as never);
  vi.mocked(rigDocument).mockResolvedValue({
    revision: 'r1',
    manifest: {
      id: 'orig',
      name: BROWN,
      format: 'f',
      formatVersion: 1,
      requiredExtensions: [],
      resources: [],
      extensions: { 'urn:oxidal:authoring': { origin: 'oxidal_example' } },
    },
  } as never);
  const { user, card } = await openBrown();
  await user.click(
    within(card).getByRole('button', { name: `Details: ${BROWN}` }),
  );
  const sheet = await screen.findByRole('dialog');
  expect(within(sheet).getByText('How to play it')).toBeVisible();
  expect(within(sheet).getByText('Chain')).toBeVisible();
  expect(within(sheet).getByText('Needs')).toBeVisible();
  // Every suggested tone links to its TONE3000 page, without a request.
  expect(
    within(sheet).getByRole('link', { name: 'Tone 65578' }),
  ).toHaveAttribute('href', 'https://www.tone3000.com/tones/65578');
  expect(within(sheet).getByText('Load')).toBeVisible();
  expect(within(sheet).getByRole('button', { name: 'Play' })).toBeEnabled();
  // the read-only sound joins the set list by reference.
  await user.click(
    within(sheet).getByRole('button', { name: 'Add to set list' }),
  );
  expect(libraryCatalog).toHaveBeenCalledWith({
    expected_revision: 'c1',
    entry_kind: 'rig',
    id: 'r1',
    action: { kind: 'set_list', member: true },
  });
  expect(
    await within(sheet).findByRole('button', { name: 'In the set list #1' }),
  ).toBeDisabled();
  await user.click(within(sheet).getByRole('button', { name: 'Make my copy' }));
  await waitFor(() => expect(publishRig).toHaveBeenCalledOnce());
  const request = vi.mocked(publishRig).mock.calls[0]![0];
  const manifest = JSON.parse(request.manifest_json);
  expect(manifest.name).toBe('Brown Crunch copy');
  expect(manifest.id).not.toBe('orig');
  expect(manifest.extensions['urn:oxidal:authoring'].origin).toBe('mine');
  expect(request.source).toEqual({ kind: 'rig', id: 'r1' });
  await screen.findByText(/Brown Crunch copy is in Mine/);
});

it('search, filters and group persist across a reload, and the summary counts them', async () => {
  const user = userEvent.setup();
  const view = render(<OxidalSounds connected onChanged={() => {}} />);
  const search = await screen.findByRole('searchbox', {
    name: 'Search Oxidal sounds',
  });
  await screen.findByText(
    /^Showing \d+ of \d+ · \d+ ready to play · \d+ need a tone or pack$/,
  );
  await user.type(search, 'crunch');
  await user.click(screen.getByRole('combobox', { name: 'Genre' }));
  await user.click(screen.getByRole('option', { name: 'Hard rock' }));
  await user.click(screen.getByRole('radio', { name: 'Engine' }));
  view.unmount();
  render(<OxidalSounds connected onChanged={() => {}} />);
  expect(
    await screen.findByRole('searchbox', { name: 'Search Oxidal sounds' }),
  ).toHaveValue('crunch');
  expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveTextContent(
    'Hard rock',
  );
  expect(screen.getByRole('radio', { name: 'Engine' })).toBeChecked();
  expect(await screen.findByRole('article', { name: BROWN })).toBeVisible();
});

it('says so when no sound matches', async () => {
  const user = userEvent.setup();
  render(<OxidalSounds connected onChanged={() => {}} />);
  await user.type(
    await screen.findByRole('searchbox', { name: 'Search Oxidal sounds' }),
    'zzzz-no-match',
  );
  expect(
    await screen.findByText('No Oxidal sounds match these filters.'),
  ).toBeVisible();
});

it('explains an unreadable unit and keeps browsing available', async () => {
  vi.mocked(installedLv2).mockRejectedValueOnce(
    new Error('LV2 discovery is unavailable'),
  );
  const user = userEvent.setup();
  render(<OxidalSounds connected onChanged={() => {}} />);
  const readError = await screen.findByText('Oxidal is not reachable');
  expect(readError).toBeVisible();
  const search = screen.getByRole('searchbox', {
    name: 'Search Oxidal sounds',
  });
  await user.type(search, BROWN);
  const card = screen.getByRole('article', { name: BROWN });
  expect(card).toHaveAttribute('data-state', 'loading');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() =>
    expect(card).not.toHaveAttribute('data-state', 'loading'),
  );
  expect(readError).not.toBeInTheDocument();
  expect(search).toHaveValue(BROWN);
});

it('an effect no pack provides makes the card Update needed, with no action but Details', async () => {
  // Oxidal's own Hold is missing: no effect pack can supply it.
  vi.mocked(installedLv2).mockResolvedValue(
    (catalog as { uri: string }[]).filter(
      (p) => p.uri !== 'urn:oxidal:plugin:hold#stereo',
    ) as never,
  );
  const user = userEvent.setup();
  render(<OxidalSounds connected onChanged={() => {}} onOpenRig={() => {}} />);
  await user.type(
    await screen.findByRole('searchbox', { name: 'Search Oxidal sounds' }),
    'Slow Weather',
  );
  const card = await screen.findByRole('article', { name: 'Slow Weather' });
  await waitFor(() =>
    expect(card).toHaveAttribute('data-state', 'unavailable'),
  );
  expect(within(card).getByText('Update needed')).toBeVisible();
  expect(
    within(card).getByText(
      /Oxidal Hold \(Stereo\), which comes with a newer Oxidal system/,
    ),
  ).toBeVisible();
  // Nothing to install, build or play: only the details.
  expect(within(card).getAllByRole('button')).toEqual([
    within(card).getByRole('button', { name: 'Details: Slow Weather' }),
  ]);
});

it('a pack install that fails outright says why, saves nothing and offers it again', async () => {
  vi.mocked(installedLv2).mockResolvedValue([]);
  vi.mocked(changeEffectPack).mockRejectedValue(
    new Error('The connection to the unit was lost.'),
  );
  const { user, card } = await openBrown();
  const install = within(card).getByRole('button', {
    name: `Install pack: ${BROWN}`,
  });
  await user.click(install);
  expect(
    await screen.findByText(
      'Could not install the pack. The connection to the unit was lost.',
    ),
  ).toBeVisible();
  expect(screen.queryByText(/Installed\./)).toBeNull();
  expect(publishRig).not.toHaveBeenCalled();
  await waitFor(() => expect(install).toBeEnabled());
  expect(card).toHaveAttribute('data-state', 'pack');
});
