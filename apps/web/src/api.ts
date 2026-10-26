import Ajv2020 from 'ajv/dist/2020';
import schema from './generated/contract.schema.json';
import type { Contract } from './generated/contract';

export type Snapshot = Contract['snapshot'];
export type Action = Contract['command']['action'];
export type MappingFile = Snapshot['mappings'];
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  formats: { uint8: true, uint32: true, double: true },
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
    throw new Error(
      typeof body === 'object' && body !== null && 'error' in body
        ? String(body.error)
        : `Device error ${response.status}`,
    );
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
  const body: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      typeof body === 'object' && body !== null && 'error' in body
        ? String(body.error)
        : 'Preset operation failed',
    );
  return body;
}
export async function presetLibrary(): Promise<Preset[]> {
  const body = await presetResponse(await fetch('/api/v1/presets'));
  if (!libraryValidator(body)) throw new Error('Incompatible preset library');
  return body.presets;
}
export async function importPreset(file: File): Promise<Preset> {
  if (file.size > 32 * 1024 * 1024)
    throw new Error('Preset exceeds the 32 MiB limit');
  const body = await presetResponse(
    await fetch('/api/v1/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
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
