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
