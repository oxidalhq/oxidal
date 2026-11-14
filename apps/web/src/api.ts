import { deviceError } from './lib/friendlyError';
import Ajv2020 from 'ajv/dist/2020';
import schema from './generated/contract.schema.json';
import type { Contract } from './generated/contract';

export type Snapshot = Contract['snapshot'];
export type Action = Contract['command']['action'];
export type MappingFile = Snapshot['mappings'];
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  formats: {
    uint: true,
    uint8: true,
    uint16: true,
    uint32: true,
    uint64: true,
    int32: true,
    double: true,
    float: true,
  },
});
const snapshotValidator = ajv.compile<Snapshot>({
  $defs: schema.$defs,
  $ref: '#/$defs/Snapshot',
});
const capabilitiesValidator = ajv.compile<Contract['capabilities']>({
  $defs: schema.$defs,
  $ref: '#/$defs/Capabilities',
});

/** Validate network payloads before exposing authoritative state to UI components.
 * @see docs/architecture.md
 */
export function parseSnapshot(value: unknown): Snapshot {
  if (!snapshotValidator(value) || value.protocol !== 1)
    throw new Error('Incompatible device state');
  return value;
}

/** Shared native command path; all MIDI and browser edits converge in the daemon.
 * @see docs/architecture.md
 */
export async function sendCommand(
  action: Action,
  revision: number | null,
  session: string,
): Promise<Snapshot> {
  const response = await fetch('/api/v1/commands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      protocol: 1,
      session,
      request_id: crypto.randomUUID(),
      expected_revision: revision,
      action,
    }),
  });
  const body: unknown = await response.json();
  if (!response.ok)
    throw deviceError(body, response.status, `Device error ${response.status}`);
  return parseSnapshot(body);
}

/** Fetch and validate the versioned device capabilities.
 * @see docs/architecture.md
 */
export async function capabilities() {
  const response = await fetch('/api/v1/health');
  const body: unknown = await response.json();
  if (!response.ok || !capabilitiesValidator(body) || body.protocol !== 1)
    throw new Error('Incompatible device capabilities');
  return body;
}

export type Preset = Contract['preset'];
const libraryValidator = ajv.compile<Contract['library']>({
  $defs: schema.$defs,
  $ref: '#/$defs/Library',
});
const presetValidator = ajv.compile<Preset>({
  $defs: schema.$defs,
  $ref: '#/$defs/Inspection',
});
async function presetResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw deviceError(
      body,
      response.status,
      `The device answered HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''} with no explanation`,
    );
  return body;
}
/** The first schema mismatch in a response, for Details: where and what. */
function schemaProblem(
  errors: { instancePath?: string; message?: string }[] | null | undefined,
): string {
  const first = errors?.[0];
  if (!first) return 'unexpected shape';
  return `${first.instancePath || 'response'} ${first.message ?? 'is invalid'}`;
}
export async function presetLibrary(): Promise<Preset[]> {
  const body = await presetResponse(await fetch('/api/v1/presets'));
  if (!libraryValidator(body)) throw new Error('Incompatible preset library');
  return body.presets;
}
export async function importPreset(
  file: File,
  signal?: AbortSignal,
): Promise<Preset> {
  if (file.size > 32 * 1024 * 1024)
    throw new Error('Preset exceeds the 32 MiB limit');
  const body = await presetResponse(
    await fetch('/api/v1/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
      signal,
    }),
  );
  if (!presetValidator(body)) throw new Error('Incompatible preset response');
  return body;
}

export type NativeSnapshot = Contract['native_editor'];
export type NativeAction = Contract['native_command']['action'];
const nativeValidator = ajv.compile<NativeSnapshot>({
  $defs: schema.$defs,
  $ref: '#/$defs/EditorSnapshot',
});
export async function nativeState(): Promise<NativeSnapshot> {
  const body = await presetResponse(await fetch('/api/v1/native'));
  if (!nativeValidator(body))
    throw new Error('Incompatible native editor state');
  return body;
}
export async function nativeCommand(
  state: NativeSnapshot,
  action: NativeAction,
): Promise<NativeSnapshot> {
  const body = await presetResponse(
    await fetch('/api/v1/native', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: state.session,
        expected_revision: state.revision,
        request_id: crypto.randomUUID(),
        action,
      }),
    }),
  );
  if (!nativeValidator(body))
    throw new Error('Incompatible native editor state');
  return body;
}

export type AudioDevices = Contract['audio_devices'];
export type AudioProbe = Contract['audio_probe'];
const audioDevicesValidator = ajv.compile<AudioDevices>({
  $defs: schema.$defs,
  $ref: '#/$defs/AudioDevices',
});
const audioProbeValidator = ajv.compile<Contract['audio_probe_result']>({
  $defs: schema.$defs,
  $ref: '#/$defs/AudioProbeResult',
});
export async function audioDevices(): Promise<AudioDevices> {
  const body = await presetResponse(await fetch('/api/v1/audio/devices'));
  if (!audioDevicesValidator(body))
    throw new Error('Incompatible audio devices response');
  return body;
}
export async function probeAudio(request: AudioProbe) {
  const body = await presetResponse(
    await fetch('/api/v1/audio/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
  if (!audioProbeValidator(body))
    throw new Error('Incompatible audio probe response');
  return body;
}

export type AudioState = Contract['audio_state'];
export type AudioAction = Contract['audio_command']['action'];
export type StartAudio = NonNullable<AudioState['configured']>;
const audioStateValidator = ajv.compile<AudioState>({
  $defs: schema.$defs,
  $ref: '#/$defs/AudioState',
});
export async function playbackState(): Promise<AudioState> {
  const body = await presetResponse(await fetch('/api/v1/audio'));
  if (!audioStateValidator(body))
    throw new Error('Incompatible playback state');
  return body;
}
export async function playbackCommand(
  state: AudioState,
  action: AudioAction,
): Promise<AudioState> {
  const body = await presetResponse(
    await fetch('/api/v1/audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: state.session,
        expected_revision: state.revision,
        action,
      }),
    }),
  );
  if (!audioStateValidator(body))
    throw new Error('Incompatible playback state');
  return body;
}

export type NetworkState = Contract['network_state'];
export type NetworkCommand = Contract['network_command'];
const networkValidator = ajv.compile<NetworkState>({
  $defs: schema.$defs,
  $ref: '#/$defs/NetworkState',
});
export async function deviceNetwork(
  command?: NetworkCommand,
): Promise<NetworkState> {
  const body = await presetResponse(
    await fetch(
      '/api/v1/device/network',
      command
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(command),
          }
        : { cache: 'no-store' },
    ),
  );
  if (!networkValidator(body)) throw new Error('Incompatible network response');
  return body;
}

export type StorageState = Contract['storage_state'];
export type StorageRequest = Contract['storage_request'];
const storageValidator = ajv.compile<StorageState>({
  $defs: schema.$defs,
  $ref: '#/$defs/StorageState',
});
async function parseStorage(response: Response): Promise<StorageState> {
  const body = await presetResponse(response);
  if (!storageValidator(body)) throw new Error('Incompatible storage response');
  return body;
}
export async function deviceStorage(): Promise<StorageState> {
  return parseStorage(
    await fetch('/api/v1/device/storage', { cache: 'no-store' }),
  );
}
export async function changeStorage(
  request: StorageRequest,
): Promise<StorageState> {
  return parseStorage(
    await fetch('/api/v1/device/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
}

export type EffectPacks = Contract['effect_packs'];
const effectPacksValidator = ajv.compile<EffectPacks>({
  $defs: schema.$defs,
  $ref: '#/$defs/PackState',
});
async function parseEffectPacks(response: Response): Promise<EffectPacks> {
  const body = await presetResponse(response);
  if (!effectPacksValidator(body))
    throw new Error('Incompatible effect-pack response');
  return body;
}
export async function effectPacks(): Promise<EffectPacks> {
  return parseEffectPacks(await fetch('/api/v1/packs', { cache: 'no-store' }));
}
export async function changeEffectPack(
  id: string,
  action: 'install' | 'remove',
): Promise<EffectPacks> {
  return parseEffectPacks(
    await fetch(
      `/api/v1/packs/${encodeURIComponent(id)}/${encodeURIComponent(action)}`,
      { method: 'POST' },
    ),
  );
}

export type Monitoring = Contract['monitoring'];
const monitoringValidator = ajv.compile<Monitoring>({
  $defs: schema.$defs,
  $ref: '#/$defs/Monitoring',
});
export async function monitoring(signal?: AbortSignal): Promise<Monitoring> {
  const response = await fetch('/api/v1/monitor', {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(4000)])
      : AbortSignal.timeout(4000),
    cache: 'no-store',
  });
  const body: unknown = await response.json();
  if (!response.ok || !monitoringValidator(body))
    throw new Error('Monitoring unavailable');
  return body;
}

export type DebugState = Contract['debug_state'];
export type DebugCommand = Contract['debug_command'];
const debugValidator = ajv.compile<DebugState>({
  $defs: schema.$defs,
  $ref: '#/$defs/State',
});
export async function debugCommand(
  command?: DebugCommand,
): Promise<DebugState> {
  const response = await fetch(
    '/api/v1/debug',
    command
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command),
          signal: AbortSignal.timeout(5000),
        }
      : { cache: 'no-store', signal: AbortSignal.timeout(5000) },
  );
  const body = await presetResponse(response);
  if (!debugValidator(body)) throw new Error('Incompatible debug service');
  return body;
}

export type AssetArtwork = Contract['artwork'][number];
const artworkValidator = ajv.compile<AssetArtwork[]>({
  $defs: schema.$defs,
  type: 'array',
  items: { $ref: '#/$defs/AssetArtwork' },
});
export function artworkPath(
  id: string,
  owned: boolean,
  key?: string,
  model = false,
) {
  if (model)
    return `/api/v1/models/${encodeURIComponent(id)}/artwork${key ? `/${encodeURIComponent(key)}` : ''}`;
  return `/api/v1/presets/${encodeURIComponent(id)}/artwork${key ? `/${encodeURIComponent(key)}` : ''}?owned=${owned}`;
}
export async function presetArtwork(
  id: string,
  owned: boolean,
  signal: AbortSignal,
  model = false,
) {
  const response = await fetch(artworkPath(id, owned, undefined, model), {
    signal,
  });
  const body: unknown = await response.json();
  if (!response.ok || !artworkValidator(body))
    throw new Error('Artwork is unavailable');
  return body;
}
export async function saveArtwork(
  id: string,
  owned: boolean,
  key: string,
  signal: AbortSignal,
  model = false,
) {
  const response = await fetch(artworkPath(id, owned, key, model), {
    method: 'POST',
    signal,
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw deviceError(body, response.status, 'Artwork download failed');
  }
}

export type TerminalState = Contract['terminal_state'];
export type TerminalCommand = Contract['terminal_command'];
const terminalValidator = ajv.compile<TerminalState>({
  $defs: schema.$defs,
  $ref: '#/$defs/TerminalState',
});
export async function terminalCommand(
  command: TerminalCommand,
  mode: 'unprivileged' | 'admin' = 'unprivileged',
): Promise<TerminalState> {
  const response = await fetch(`/api/v1/terminal/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  const body = await presetResponse(response);
  if (!terminalValidator(body))
    throw new Error('Incompatible terminal service');
  return body;
}

export type AccountState = Contract['account_state'];
export type AccountAction = Contract['account_command']['action'];
const accountValidator = ajv.compile<AccountState>({
  $defs: schema.$defs,
  $ref: '#/$defs/AccountState',
});
export async function tone3000Account(command?: {
  state: AccountState;
  action: AccountAction;
}): Promise<AccountState> {
  const body = await presetResponse(
    await fetch(
      '/api/v1/account/tone3000',
      command
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session: command.state.session,
              expected_revision: command.state.revision,
              action: command.action,
            }),
          }
        : undefined,
    ),
  );
  if (!accountValidator(body)) throw new Error('Incompatible account response');
  return body;
}

export type TonePage = Contract['tone_page'];
export type ModelPage = Contract['model_page'];
export type ToneQuery = Contract['tone_query'];
const tonesValidator = ajv.compile<TonePage>({
  $defs: schema.$defs,
  $ref: '#/$defs/Page',
});
const modelsValidator = ajv.compile<ModelPage>({
  $defs: schema.$defs,
  $ref: '#/$defs/Page2',
});
const stagedValidator = ajv.compile<Contract['staged_model']>({
  $defs: schema.$defs,
  $ref: '#/$defs/StagedModel',
});
export async function tone3000Tones(
  query: ToneQuery,
  signal: AbortSignal,
): Promise<TonePage> {
  const params = new URLSearchParams({
    collection: query.collection ?? 'latest',
    page: String(query.page ?? 1),
    query: query.query ?? '',
  });
  if (query.gear) params.set('gear', query.gear);
  const body = await presetResponse(
    await fetch(`/api/v1/tone3000/tones?${params}`, {
      signal,
      cache: 'no-store',
    }),
  );
  if (!tonesValidator(body)) throw new Error('Incompatible tone catalog');
  return body;
}
export async function tone3000Tone(
  id: number,
  signal: AbortSignal,
): Promise<TonePage['data'][number]> {
  const body = await presetResponse(
    await fetch(`/api/v1/tone3000/tones/${id}`, { signal, cache: 'no-store' }),
  );
  const validate = ajv.compile<TonePage['data'][number]>({
    $defs: schema.$defs,
    $ref: '#/$defs/Tone',
  });
  if (!validate(body))
    throw new Error(
      `Incompatible TONE3000 tone details (${schemaProblem(validate.errors)})`,
    );
  return body;
}
export async function tone3000Models(
  tone: number,
  page: number,
  signal: AbortSignal,
  format: 'nam' | 'ir' = 'nam',
): Promise<ModelPage> {
  const params = new URLSearchParams({
    tone_id: String(tone),
    page: String(page),
    architecture: format === 'nam' ? '2' : 'any',
  });
  const body = await presetResponse(
    await fetch(`/api/v1/tone3000/models?${params}`, {
      signal,
      cache: 'no-store',
    }),
  );
  if (!modelsValidator(body))
    throw new Error(
      `Incompatible model catalog (${schemaProblem(modelsValidator.errors)})`,
    );
  return body;
}
export async function stageTone3000(
  tone: number,
  model: number,
  signal: AbortSignal,
) {
  const body = await presetResponse(
    await fetch('/api/v1/tone3000/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tone_id: tone, model_id: model }),
      signal,
    }),
  );
  if (
    !stagedValidator(body) ||
    body.tone_id !== tone ||
    body.model_id !== model
  )
    throw new Error('Downloaded model identity differs');
  return body;
}

export type VoiceReady = Contract['voice_ready'];
const voiceReadyValidator = ajv.compile<VoiceReady>({
  $defs: schema.$defs,
  $ref: '#/$defs/VoiceReady',
});
const voiceListValidator = ajv.compile<Contract['voice_list']>({
  $defs: schema.$defs,
  $ref: '#/$defs/VoiceList',
});
/** Download one capture the player asked for and make it a usable native preset.
 * Asking again for a capture already on the device reuses it. */
export async function downloadVoice(
  tone: number,
  model: number,
  name: string,
  signal?: AbortSignal,
): Promise<VoiceReady> {
  const response = await fetch('/api/v1/tone3000/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tone_id: tone, model_id: model, name }),
    signal,
  });
  // An older device has no such endpoint; say so instead of a bare failure.
  if (response.status === 404 || response.status === 405)
    throw new Error(
      'This device needs a software update to download captures.',
    );
  const body = await presetResponse(response);
  if (
    !voiceReadyValidator(body) ||
    body.capture.tone_id !== tone ||
    body.capture.model_id !== model
  )
    throw new Error('Downloaded capture identity differs');
  return body;
}
/** Captures already downloaded to this device. */
/** Captures made for Oxidal sounds, and TONE3000 models already downloaded
 * (for example in Tones and IRs) that can become one without a download. */
export async function voiceCaptures(
  signal?: AbortSignal,
): Promise<Contract['voice_list']> {
  const body = await presetResponse(
    await fetch('/api/v1/tone3000/voice', { signal, cache: 'no-store' }),
  );
  if (!voiceListValidator(body)) throw new Error('Incompatible capture list');
  return body;
}

export type GraphAudioState = Contract['graph_audio_state'];
export type GraphAudioAction = Contract['graph_audio_command']['action'];
export type GraphSettings = NonNullable<GraphAudioState['configured']>;
export type Lv2Plugin = Contract['lv2_catalog']['plugins'][number];
export type SavedGraph = Contract['graph_presets'][number];
const graphStateValidator = ajv.compile<GraphAudioState>({
  $defs: schema.$defs,
  $ref: '#/$defs/GraphAudioState',
});
const graphLibraryValidator = ajv.compile<Contract['graph_presets']>({
  $defs: schema.$defs,
  type: 'array',
  items: { $ref: '#/$defs/SavedGraph' },
});
const lv2CatalogValidator = ajv.compile<Contract['lv2_catalog']>({
  $defs: schema.$defs,
  $ref: '#/$defs/PluginCatalog',
});
export async function graphAudioState(): Promise<GraphAudioState> {
  const body = await presetResponse(await fetch('/api/v1/graph-audio'));
  if (!graphStateValidator(body)) throw new Error('Incompatible graph state');
  return body;
}
export async function graphAudioCommand(
  state: GraphAudioState,
  action: GraphAudioAction,
): Promise<GraphAudioState> {
  const body = await presetResponse(
    await fetch('/api/v1/graph-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: state.session,
        expected_revision: state.revision,
        action,
      }),
    }),
  );
  if (!graphStateValidator(body)) throw new Error('Incompatible graph state');
  return body;
}
export async function graphLibrary(): Promise<SavedGraph[]> {
  const body = await presetResponse(await fetch('/api/v1/presets/graphs'));
  if (!graphLibraryValidator(body))
    throw new Error('Incompatible graph library');
  return body;
}
/** One scan at a time: callers asking together share the same answer. */
const lv2Scans = new Map<number, Promise<Lv2Plugin[]>>();
export function installedLv2(sampleRate: number): Promise<Lv2Plugin[]> {
  const pending = lv2Scans.get(sampleRate);
  if (pending) return pending;
  const scan = (async () => {
    const body = await presetResponse(
      await fetch(`/api/v1/plugins/lv2?sample_rate=${sampleRate}`),
    );
    if (!lv2CatalogValidator(body) || body.sample_rate !== sampleRate)
      throw new Error('Incompatible effects catalog');
    return body.plugins;
  })().finally(() => lv2Scans.delete(sampleRate));
  lv2Scans.set(sampleRate, scan);
  return scan;
}

export type RigAudioState = Contract['rig_audio_state'];
export type RigAudioAction = Contract['rig_audio_command']['action'];
export type RigControl = NonNullable<
  RigAudioState['control']
>['controls'][number];
export type RigDocument = Contract['rig_document'];
export type RigPage = Contract['rig_library'];
const rigStateValidator = ajv.compile<RigAudioState>({
  $defs: schema.$defs,
  $ref: '#/$defs/RigAudioState',
});
const rigDocumentValidator = ajv.compile<RigDocument>({
  $defs: schema.$defs,
  $ref: '#/$defs/RigDocument',
});
const rigPageValidator = ajv.compile<RigPage>({
  $defs: schema.$defs,
  $ref: '#/$defs/RigPage',
});
export async function rigAudioState(): Promise<RigAudioState> {
  const body = await presetResponse(await fetch('/api/v1/rig-audio'));
  if (!rigStateValidator(body)) throw new Error('Incompatible rig state');
  return body;
}
export async function rigAudioCommand(
  state: RigAudioState,
  action: RigAudioAction,
): Promise<RigAudioState> {
  const body = await presetResponse(
    await fetch('/api/v1/rig-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: state.session,
        expected_revision: state.revision,
        action,
      }),
    }),
  );
  if (!rigStateValidator(body)) throw new Error('Incompatible rig state');
  return body;
}
export async function rigDocument(revision: string): Promise<RigDocument> {
  const body = await presetResponse(
    await fetch(`/api/v1/presets/rigs/${encodeURIComponent(revision)}`),
  );
  if (!rigDocumentValidator(body)) throw new Error('Incompatible rig document');
  return body;
}
export async function rigLibrary(after?: string): Promise<RigPage> {
  const body = await presetResponse(
    await fetch(
      `/api/v1/presets/rigs${after ? `?after=${encodeURIComponent(after)}` : ''}`,
    ),
  );
  if (!rigPageValidator(body)) throw new Error('Incompatible rig library');
  return body;
}

/** Copies one TONE3000 file of a saved preset into the library (7.3). */
export async function importRigResource(
  revision: string,
  resource: string,
): Promise<Preset> {
  const body = await presetResponse(
    await fetch(
      `/api/v1/presets/rigs/${encodeURIComponent(revision)}/resources/${encodeURIComponent(resource)}/import`,
      { method: 'POST' },
    ),
  );
  if (!presetValidator(body)) throw new Error('Incompatible preset response');
  return body;
}

export async function publishRig(
  request: Contract['rig_publish'],
  signal?: AbortSignal,
): Promise<RigDocument> {
  const body = await presetResponse(
    await fetch('/api/v1/presets/rigs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    }),
  );
  if (!rigDocumentValidator(body)) throw new Error('Incompatible saved rig');
  return body;
}

const rigSourcesValidator = ajv.compile<Contract['rig_native_sources']>({
  $defs: schema.$defs,
  type: 'array',
  items: { $ref: '#/$defs/RigNativeSource' },
});
export async function rigNativeSources(signal?: AbortSignal) {
  const body = await presetResponse(
    await fetch('/api/v1/presets/rig-sources', { signal }),
  );
  if (!rigSourcesValidator(body)) throw new Error('Incompatible tone library');
  return body;
}

export type MidiDevices = Contract['midi_devices'];
const midiDevicesValidator = ajv.compile<MidiDevices>({
  $defs: schema.$defs,
  $ref: '#/$defs/Devices',
});
export async function midiDevices(): Promise<MidiDevices> {
  const body = await presetResponse(await fetch('/api/v1/midi/devices'));
  if (!midiDevicesValidator(body))
    throw new Error('Incompatible MIDI device list');
  return body;
}

export type MidiMap = Contract['midi_map'];
const midiMapValidator = ajv.compile<MidiMap>({
  $defs: schema.$defs,
  $ref: '#/$defs/MidiMap',
});
export async function midiMap(): Promise<MidiMap> {
  const body = await presetResponse(await fetch('/api/v1/midi/map'));
  if (!midiMapValidator(body)) throw new Error('Incompatible MIDI map');
  return body;
}
export type MidiMapUpdate = Contract['midi_map_update'];
export async function updateMidiMap(update: MidiMapUpdate): Promise<MidiMap> {
  const body = await presetResponse(
    await fetch('/api/v1/midi/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    }),
  );
  if (!midiMapValidator(body)) throw new Error('Incompatible MIDI map');
  return body;
}
export async function applyMidiTemplate(
  request: Contract['midi_template_apply'],
): Promise<MidiMap> {
  const body = await presetResponse(
    await fetch('/api/v1/midi/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
  if (!midiMapValidator(body)) throw new Error('Incompatible MIDI map');
  return body;
}
export async function testMidi(request: Contract['midi_test']): Promise<void> {
  const response = await fetch('/api/v1/midi/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) await presetResponse(response);
}

export type MidiAction = Contract['midi_action'];
const midiActionValidator = ajv.compile<MidiAction>({
  $defs: schema.$defs,
  $ref: '#/$defs/MidiAction',
});
/** The newest device-wide MIDI action (Program recall, navigation, mute or tuner). */
export async function midiAction(): Promise<MidiAction> {
  const body = await presetResponse(await fetch('/api/v1/midi/action'));
  if (!midiActionValidator(body)) throw new Error('Incompatible MIDI action');
  return body;
}
export type MidiPosition = Contract['midi_position'];
const midiPositionValidator = ajv.compile<MidiPosition>({
  $defs: schema.$defs,
  $ref: '#/$defs/MidiPosition',
});
/** The playing preset's place in the Mine set-list and its neighbours' readiness. */
export async function midiPosition(): Promise<MidiPosition> {
  const body = await presetResponse(await fetch('/api/v1/midi/position'));
  if (!midiPositionValidator(body))
    throw new Error('Incompatible set-list position');
  return body;
}
/** Flips the output mute exactly as the footswitch does. */
export async function muteMidi(): Promise<void> {
  const response = await fetch('/api/v1/midi/mute', { method: 'POST' });
  if (!response.ok) await presetResponse(response);
}
/** Moves one preset through the Mine set-list, exactly as a footswitch does. */
export async function navigateMidi(
  direction: Contract['midi_navigate']['direction'],
): Promise<void> {
  const response = await fetch('/api/v1/midi/navigate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  });
  if (!response.ok) await presetResponse(response);
}

/** Passive learning: input is recorded but its mappings do not run. */
export async function learnMidi(on: boolean): Promise<void> {
  const request: Contract['midi_learn'] = { on };
  const response = await fetch('/api/v1/midi/learn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) await presetResponse(response);
}

export type NativeDefaults = Contract['native_defaults'];
const nativeDefaultsValidator = ajv.compile<NativeDefaults>({
  $defs: schema.$defs,
  $ref: '#/$defs/NativeDefaults',
});
export async function nativeDefaults(
  update?: Contract['native_defaults_update'],
): Promise<NativeDefaults> {
  const body = await presetResponse(
    await fetch(
      '/api/v1/native/defaults',
      update
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(update),
          }
        : undefined,
    ),
  );
  if (!nativeDefaultsValidator(body))
    throw new Error('Incompatible native defaults');
  return body;
}

export type UnitLevels = Contract['unit_levels'];
const unitLevelsValidator = ajv.compile<UnitLevels>({
  $defs: schema.$defs,
  $ref: '#/$defs/HostLevels',
});
/** Unit-wide input trim and master level; null when the daemon predates them. */
export async function unitLevels(
  update?: UnitLevels,
  signal?: AbortSignal,
): Promise<UnitLevels | null> {
  const response = await fetch(
    '/api/v1/levels',
    update
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update),
          signal,
        }
      : { signal },
  );
  if (response.status === 404) return null;
  const body = await presetResponse(response);
  if (!unitLevelsValidator(body)) throw new Error('Incompatible levels');
  return body;
}

export type GuitarProfiles = Contract['guitars'];
const guitarsValidator = ajv.compile<GuitarProfiles>({
  $defs: schema.$defs,
  $ref: '#/$defs/Guitars',
});
/** Unit-wide guitar profiles; saving applies the active guitar's input trim. */
export async function guitarProfiles(
  update?: GuitarProfiles,
  signal?: AbortSignal,
): Promise<GuitarProfiles | null> {
  const response = await fetch(
    '/api/v1/guitars',
    update
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update),
          signal,
        }
      : { signal },
  );
  if (response.status === 404) return null;
  const body = await presetResponse(response);
  if (!guitarsValidator(body)) throw new Error('Incompatible guitar profiles');
  return body;
}

export type TunerState = Contract['tuner_state'];
export type TunerUpdate = Contract['tuner_update'];
const tunerValidator = ajv.compile<TunerState>({
  $defs: schema.$defs,
  $ref: '#/$defs/TunerState',
});
/** Oxidal's input tuner; an update starts or stops it. Null on older units. */
export async function tuner(
  update?: TunerUpdate,
  signal?: AbortSignal,
): Promise<TunerState | null> {
  const response = await fetch(
    '/api/v1/tuner',
    update
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update),
          signal,
        }
      : { signal },
  );
  if (response.status === 404) return null;
  const body = await presetResponse(response);
  if (!tunerValidator(body)) throw new Error('Incompatible tuner state');
  return body;
}

export type BoostState = Contract['boosts'];
const boostsValidator = ajv.compile<BoostState>({
  $defs: schema.$defs,
  $ref: '#/$defs/BoostState',
});
/** Preset and scene boosts; setting one applies it at once if it is playing. */
export async function boosts(
  update?: Contract['boost_update'],
  signal?: AbortSignal,
): Promise<BoostState | null> {
  const response = await fetch(
    '/api/v1/boosts',
    update
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update),
          signal,
        }
      : { signal },
  );
  if (response.status === 404) return null;
  const body = await presetResponse(response);
  if (!boostsValidator(body)) throw new Error('Incompatible boosts');
  return body;
}

export type SceneBlends = Contract['scene_blends'];
const blendsValidator = ajv.compile<SceneBlends>({
  $defs: schema.$defs,
  $ref: '#/$defs/Blends',
});
/** How presets with scenes change scene: trails, or a blend of N ms. */
export async function sceneBlends(
  update?: Contract['scene_blend_update'],
  signal?: AbortSignal,
): Promise<SceneBlends | null> {
  const response = await fetch(
    '/api/v1/scene-blends',
    update
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update),
          signal,
        }
      : { signal },
  );
  if (response.status === 404) return null;
  const body = await presetResponse(response);
  if (!blendsValidator(body)) throw new Error('Incompatible scene blends');
  return body;
}

export type SharedSceneDraft = Contract['scene_draft'];
const sceneDraftValidator = ajv.compile<SharedSceneDraft>({
  $defs: schema.$defs,
  $ref: '#/$defs/SceneDraftState',
});
/**
 * The unsaved scene draft the device holds for every browser (7.7): read it,
 * or replace it (null clears it). Older daemons without one return null.
 */
export async function sceneDraft(
  update?: Contract['scene_draft_update'],
  signal?: AbortSignal,
): Promise<SharedSceneDraft | null> {
  const response = await fetch(
    '/api/v1/scene-draft',
    update
      ? {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update),
          signal,
        }
      : { signal },
  );
  if (response.status === 404 || response.status === 405) return null;
  const body = await presetResponse(response);
  if (!sceneDraftValidator(body)) throw new Error('Incompatible scene draft');
  return body;
}

export type CalibrationState = Contract['calibration'];
export type CalibrationCoverage = Contract['calibration_coverage'];
const calibrationValidator = ajv.compile<CalibrationState>({
  $defs: schema.$defs,
  $ref: '#/$defs/CalibrationState',
});
/** Even out all: state, or a run / run_all / cancel / reset command. */
export async function calibration(
  action?: Contract['calibration_command']['action'],
  signal?: AbortSignal,
): Promise<CalibrationState | null> {
  const response = await fetch(
    '/api/v1/calibration',
    action
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
          signal,
        }
      : { signal },
  );
  if (response.status === 404) return null;
  const body = await presetResponse(response);
  if (!calibrationValidator(body)) throw new Error('Incompatible calibration');
  return body;
}

const calibrationCoverageValidator = ajv.compile<CalibrationCoverage>({
  $defs: schema.$defs,
  $ref: '#/$defs/CalibrationCoverage',
});
/** Current preset/scene coverage, scanned on demand rather than on the audio poll. */
export async function calibrationCoverage(
  signal?: AbortSignal,
): Promise<CalibrationCoverage | null> {
  const response = await fetch('/api/v1/calibration/coverage', { signal });
  if (response.status === 404) return null;
  const body = await presetResponse(response);
  if (!calibrationCoverageValidator(body))
    throw new Error('Incompatible calibration coverage');
  return body;
}

export type LocalModel = Contract['local_model'];
export type LocalModelPage = Contract['local_model_page'];
const localModelValidator = ajv.compile<LocalModel>({
  $defs: schema.$defs,
  $ref: '#/$defs/LocalModel',
});
const localModelsValidator = ajv.compile<LocalModelPage>({
  $defs: schema.$defs,
  $ref: '#/$defs/LocalModelPage',
});
/** A tone's picture, fetched once through the unit and kept there. */
export const toneImage = (id: number) => `/api/v1/tone3000/tones/${id}/image`;
export async function localModels(
  after: string | null,
  signal: AbortSignal,
  all = false,
  filter?: { format: 'nam' | 'ir'; query: string },
): Promise<LocalModelPage> {
  const params = new URLSearchParams();
  if (after) params.set('after', after);
  if (all) params.set('all', 'true');
  if (filter) {
    params.set('format', filter.format);
    if (filter.query.trim()) params.set('query', filter.query.trim());
  }
  const query = params.size ? `?${params}` : '';
  const body = await presetResponse(
    await fetch(`/api/v1/models/local${query}`, { signal, cache: 'no-store' }),
  );
  if (!localModelsValidator(body))
    throw new Error('Incompatible local model library');
  return body;
}
export async function uploadLocalModel(
  file: File,
  signal: AbortSignal,
): Promise<LocalModel> {
  if (file.size === 0 || file.size > 32 * 1024 * 1024)
    throw new Error('Choose a file up to 32 MiB.');
  const params = new URLSearchParams({ name: file.name });
  const folder = file.webkitRelativePath?.split('/').slice(0, -1).join('/');
  if (folder) params.set('folder', folder);
  const body = await presetResponse(
    await fetch(`/api/v1/models/local?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
      signal,
    }),
  );
  if (!localModelValidator(body))
    throw new Error('Incompatible local model receipt');
  return body;
}

export async function stageLocalCollection(
  assets: string[],
  signal: AbortSignal,
): Promise<LocalModel> {
  const body = await presetResponse(
    await fetch('/api/v1/models/local/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assets }),
      signal,
    }),
  );
  if (!localModelValidator(body))
    throw new Error('Incompatible local collection receipt');
  return body;
}

export type LibraryCatalog = Contract['library_catalog'];
export type LibraryUpdate = Contract['library_update'];
const catalogValidator = ajv.compile<LibraryCatalog>({
  $defs: schema.$defs,
  $ref: '#/$defs/LibraryCatalog',
});
export async function libraryCatalog(
  update?: LibraryUpdate,
): Promise<LibraryCatalog> {
  const body = await presetResponse(
    await fetch(
      '/api/v1/presets/catalog',
      update
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(update),
          }
        : undefined,
    ),
  );
  if (!catalogValidator(body)) throw new Error('Incompatible library catalog');
  return body;
}

export type MonitoringHistory = Contract['monitoring_history'];
const historyValidator = ajv.compile<MonitoringHistory>({
  $defs: schema.$defs,
  $ref: '#/$defs/History',
});
export async function monitoringHistory(
  signal?: AbortSignal,
): Promise<MonitoringHistory> {
  const response = await fetch('/api/v1/monitor/history', { signal });
  const body = await presetResponse(response);
  if (!historyValidator(body))
    throw new Error('Incompatible monitoring history');
  return body;
}

export type ControlAudit = Contract['control_audit'];
const auditValidator = ajv.compile<ControlAudit>({
  $defs: schema.$defs,
  $ref: '#/$defs/AuditHistory',
});
export async function controlAudit(
  signal?: AbortSignal,
): Promise<ControlAudit> {
  const body = await presetResponse(await fetch('/api/v1/audit', { signal }));
  if (!auditValidator(body)) throw new Error('Incompatible control audit');
  return body;
}

export type RemovalPreview = Contract['removal_preview'];
export type RemovalRequest = Contract['removal_request'];
export type RemovalResult = Contract['removal_result'];
const removalPreviewValidator = ajv.compile<RemovalPreview>({
  $defs: schema.$defs,
  $ref: '#/$defs/RemovalPreview',
});
const removalResultValidator = ajv.compile<RemovalResult>({
  $defs: schema.$defs,
  $ref: '#/$defs/RemovalResult',
});
export async function removalPreview(
  entry: Pick<RemovalRequest, 'entry_kind' | 'id'>,
): Promise<RemovalPreview> {
  const body = await presetResponse(
    await fetch(
      `/api/v1/presets/removal?${new URLSearchParams({ kind: entry.entry_kind, id: entry.id })}`,
    ),
  );
  if (!removalPreviewValidator(body))
    throw new Error('Incompatible deletion preview');
  return body;
}
export async function removePreset(
  request: RemovalRequest,
): Promise<RemovalResult> {
  const body = await presetResponse(
    await fetch('/api/v1/presets/removal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
  if (!removalResultValidator(body))
    throw new Error(
      'Deletion outcome could not be read. Refresh Library before retrying.',
    );
  return body;
}

export type ProtectState = Contract['protect_state'];
const protectValidator = ajv.compile<ProtectState>({
  $defs: schema.$defs,
  $ref: '#/$defs/ProtectState',
});
/** The device-wide performance lock, stored by the daemon (7.22). */
export async function protectState(): Promise<ProtectState> {
  const body = await presetResponse(await fetch('/api/v1/protect'));
  if (!protectValidator(body)) throw new Error('Incompatible Protect state');
  return body;
}
export async function setProtect(on: boolean): Promise<ProtectState> {
  const body = await presetResponse(
    await fetch('/api/v1/protect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on }),
    }),
  );
  if (!protectValidator(body)) throw new Error('Incompatible Protect state');
  return body;
}

export type KeepReady = Contract['keep_ready'];
const keepReadyValidator = ajv.compile<KeepReady>({
  $defs: schema.$defs,
  $ref: '#/$defs/KeepReady',
});
export async function keepReady(): Promise<KeepReady> {
  const body = await presetResponse(await fetch('/api/v1/presets/keep-ready'));
  if (!keepReadyValidator(body))
    throw new Error('Incompatible Keep ready list');
  return body;
}
export async function setKeepReady(revisions: string[]): Promise<KeepReady> {
  const body = await presetResponse(
    await fetch('/api/v1/presets/keep-ready', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revisions }),
    }),
  );
  if (!keepReadyValidator(body))
    throw new Error('Incompatible Keep ready list');
  return body;
}

export type StartupState = Contract['startup_state'];
const startupValidator = ajv.compile<StartupState>({
  $defs: schema.$defs,
  $ref: '#/$defs/StartupState',
});
/** What starts when Oxidal starts: Off, Last played or Pinned (7.25). */
export async function startupState(): Promise<StartupState> {
  const body = await presetResponse(await fetch('/api/v1/startup'));
  if (!startupValidator(body)) throw new Error('Incompatible startup state');
  return body;
}
/** Capture a reviewed saved target and policy atomically; reject stale reviews.
 * @see docs/audio.md
 */
export async function setStartupFollow(
  follow: boolean,
  options: Pick<Contract['startup_update'], 'capture' | 'expected'> = {},
): Promise<StartupState> {
  const body = await presetResponse(
    await fetch('/api/v1/startup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ follow, ...options }),
    }),
  );
  if (!startupValidator(body)) throw new Error('Incompatible startup state');
  return body;
}

export type ModelRemovalPreview = Contract['model_removal_preview'];
export type ModelRemovalResult = Contract['model_removal_result'];
const modelRemovalPreviewValidator = ajv.compile<ModelRemovalPreview>({
  $defs: schema.$defs,
  $ref: '#/$defs/ModelRemovalPreview',
});
const modelRemovalResultValidator = ajv.compile<ModelRemovalResult>({
  $defs: schema.$defs,
  $ref: '#/$defs/ModelRemovalResult',
});
/** What deleting one NAM/IR file would affect; nothing is deleted. */
export async function modelRemovalPreview(
  id: string,
): Promise<ModelRemovalPreview> {
  const body = await presetResponse(
    await fetch(`/api/v1/models/local/removal?${new URLSearchParams({ id })}`),
  );
  if (!modelRemovalPreviewValidator(body))
    throw new Error('Incompatible deletion preview');
  return body;
}
/** Deletes one unused NAM/IR file confirmed by its preview token. */
export async function removeModel(
  id: string,
  expectedPreview: string,
): Promise<ModelRemovalResult> {
  const body = await presetResponse(
    await fetch('/api/v1/models/local/removal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, expected_preview: expectedPreview }),
    }),
  );
  if (!modelRemovalResultValidator(body))
    throw new Error(
      'Deletion outcome could not be read. Refresh Sounds before retrying.',
    );
  return body;
}

export type PresetDetails =
  Contract['preset_details']['entries'][number]['details'];
export type DetailsCatalog = Contract['preset_details'];
export type DetailsUpdate = Contract['preset_details_update'];
const detailsValidator = ajv.compile<DetailsCatalog>({
  $defs: schema.$defs,
  $ref: '#/$defs/DetailsCatalog',
});
export async function presetDetails(
  update?: DetailsUpdate,
): Promise<DetailsCatalog> {
  const body = await presetResponse(
    await fetch(
      '/api/v1/presets/details',
      update
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(update),
          }
        : undefined,
    ),
  );
  if (!detailsValidator(body)) throw new Error('Incompatible preset details');
  return body;
}

export type MediaLibrary = Contract['media_library'];
export type MediaAsset = MediaLibrary['assets'][number];
export type AssetUpdate = Contract['media_asset_update'];
export type UploadState = Contract['media_upload_state'];
export type PlayerSnapshot = Contract['player_snapshot'];
export type PlayerRequest = Contract['player_request'];
const mediaLibraryValidator = ajv.compile<MediaLibrary>({
  $defs: schema.$defs,
  $ref: '#/$defs/MediaLibrary',
});
const mediaAssetValidator = ajv.compile<MediaAsset>({
  $defs: schema.$defs,
  $ref: '#/$defs/MediaManifest',
});
const uploadValidator = ajv.compile<UploadState>({
  $defs: schema.$defs,
  $ref: '#/$defs/UploadState',
});
const playerValidator = ajv.compile<PlayerSnapshot>({
  $defs: schema.$defs,
  $ref: '#/$defs/PlayerSnapshot',
});
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
function uploadBody(body: unknown): UploadState {
  if (!uploadValidator(body)) throw new Error('Incompatible upload state');
  return body;
}

/** Backing tracks and other session media kept on the device.
 * @see docs/media.md
 */
export async function mediaLibrary(): Promise<MediaLibrary> {
  const body = await presetResponse(await fetch('/api/v1/media'));
  if (!mediaLibraryValidator(body)) throw new Error('Incompatible media list');
  return body;
}
/** Rename or re-trim a track; the files never change. */
export async function updateAsset(
  id: string,
  update: AssetUpdate,
): Promise<MediaAsset> {
  const body = await presetResponse(
    await fetch(
      `/api/v1/media/assets/${encodeURIComponent(id)}`,
      json('PATCH', update),
    ),
  );
  if (!mediaAssetValidator(body)) throw new Error('Incompatible media file');
  return body;
}
/** Refused with 409 while the track plays or a job uses it. */
export async function deleteAsset(id: string): Promise<void> {
  const response = await fetch(
    `/api/v1/media/assets/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) await presetResponse(response);
}
export const originalPath = (id: string) =>
  `/api/v1/media/assets/${encodeURIComponent(id)}/original`;

/** A chunk sent at an offset the device has not confirmed; resume from `state`. */
export class OffsetConflict extends Error {
  constructor(readonly state: UploadState) {
    super('The upload offset moved');
    this.name = 'OffsetConflict';
  }
}
export async function startUpload(
  name: string,
  size: number,
): Promise<UploadState> {
  return uploadBody(
    await presetResponse(
      await fetch('/api/v1/media/uploads', json('POST', { name, size })),
    ),
  );
}
export async function sendChunk(
  id: string,
  offset: number,
  chunk: Blob,
  signal?: AbortSignal,
): Promise<UploadState> {
  const response = await fetch(
    `/api/v1/media/uploads/${encodeURIComponent(id)}?offset=${offset}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: chunk,
      signal,
    },
  );
  if (response.status === 409) {
    const body: unknown = await response.json().catch(() => null);
    if (uploadValidator(body)) throw new OffsetConflict(body);
    throw deviceError(body, 409, 'The upload is busy');
  }
  return uploadBody(await presetResponse(response));
}
export async function uploadStatus(id: string): Promise<UploadState> {
  return uploadBody(
    await presetResponse(
      await fetch(`/api/v1/media/uploads/${encodeURIComponent(id)}`),
    ),
  );
}
/** Continue a duplicate as a second copy. */
export async function importCopy(id: string): Promise<UploadState> {
  return uploadBody(
    await presetResponse(
      await fetch(
        `/api/v1/media/uploads/${encodeURIComponent(id)}/import`,
        json('POST', { copy: true }),
      ),
    ),
  );
}
export async function cancelUpload(id: string): Promise<void> {
  const response = await fetch(
    `/api/v1/media/uploads/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  if (!response.ok && response.status !== 404) await presetResponse(response);
}

/** Validate a backing player snapshot from a response or the event stream. */
export function parsePlayer(value: unknown): PlayerSnapshot {
  if (!playerValidator(value)) throw new Error('Incompatible player state');
  return value;
}
/** Every player control in the app goes through this one daemon handler.
 * @see docs/media.md
 */
export async function playerCommand(
  request: PlayerRequest,
): Promise<PlayerSnapshot> {
  return parsePlayer(
    await presetResponse(
      await fetch('/api/v1/player/commands', json('POST', request)),
    ),
  );
}
/** Reorder the Backing list; refused under Protect or when the set changed. */
export async function setPlayerOrder(order: string[]): Promise<PlayerSnapshot> {
  return parsePlayer(
    await presetResponse(
      await fetch('/api/v1/player/order', json('PUT', { order })),
    ),
  );
}

export type VenueState = Contract['venue_state'];
export type VenueRequest = Contract['venue_request'];
export type VenueCommand = VenueRequest['command'];
type VenueProfile = VenueState['profiles'][number];
export type VenueSettings = VenueProfile['eq'];
export type VenueBand = VenueSettings['bands'][number];
const venueValidator = ajv.compile<VenueState>({
  $defs: schema.$defs,
  $ref: '#/$defs/VenueState',
});
/** Validate a venue EQ state from a response or the event stream. */
export function parseVenue(value: unknown): VenueState {
  if (!venueValidator(value)) throw new Error('Incompatible venue EQ state');
  return value;
}
/** Another client changed the venue EQ first; `state` is the device's now. */
export class VenueConflict extends Error {
  constructor(readonly state: VenueState) {
    super('Someone else changed the venue EQ');
    this.name = 'VenueConflict';
  }
}
/** The venue EQ: profiles, the active one, bypass and any unsaved preview.
 * @see docs/media.md
 */
export async function venueState(): Promise<VenueState> {
  return parseVenue(await presetResponse(await fetch('/api/v1/venues')));
}
/** Every venue EQ change goes through this one revision-checked handler.
 * A stale revision throws `VenueConflict` carrying the current state.
 * @see docs/media.md
 */
export async function venueCommand(request: VenueRequest): Promise<VenueState> {
  const response = await fetch(
    '/api/v1/venues/commands',
    json('POST', request),
  );
  if (response.status === 409) {
    const body: unknown = await response.json().catch(() => null);
    if (venueValidator(body)) throw new VenueConflict(body);
    throw deviceError(body, 409, 'The venue EQ changed');
  }
  return parseVenue(await presetResponse(response));
}
/** Keeps an unsaved venue preview from being discarded while it is edited. */
export async function keepVenuePreview(): Promise<void> {
  const response = await fetch('/api/v1/venues/preview/keep', {
    method: 'POST',
  });
  if (!response.ok) await presetResponse(response);
}

export type CaptureState = Contract['capture_state'];
export type CaptureJob = NonNullable<CaptureState['job']>;
export type ReampRequest = Contract['reamp_request'];
const captureValidator = ajv.compile<CaptureState>({
  $defs: schema.$defs,
  $ref: '#/$defs/CaptureState',
});
async function captureResponse(response: Response): Promise<CaptureState> {
  const body = await presetResponse(response);
  if (!captureValidator(body)) throw new Error('Incompatible recording state');
  return body;
}
/** The current or last Record DI / reamp job; it survives a closed page. */
export async function captureState(): Promise<CaptureState> {
  return captureResponse(await fetch('/api/v1/capture'));
}
/** Records the raw guitar (before trim, gate and effects) as a DI. */
export async function recordDi(): Promise<CaptureState> {
  return captureResponse(
    await fetch('/api/v1/capture/record-di', { method: 'POST' }),
  );
}
/** Reamps a DI through the rig that is playing now. */
export async function startReamp(request: ReampRequest): Promise<CaptureState> {
  return captureResponse(
    await fetch('/api/v1/capture/reamp', json('POST', request)),
  );
}
/** Stop and keep (`keep`), or Cancel and discard. */
export async function stopCapture(keep: boolean): Promise<CaptureState> {
  return captureResponse(
    await fetch('/api/v1/capture/stop', json('POST', { keep })),
  );
}
export const wavPath = (id: string) =>
  `/api/v1/media/assets/${encodeURIComponent(id)}/wav`;
