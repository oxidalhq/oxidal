/**
 * One sentence a player can act on: what failed, the cause in plain words and,
 * where known, what to do next. Raw `Error: …` strings never reach the screen;
 * the original text stays available through `errorDetails` for Details.
 * @see docs/interface.md
 */
import type { ApiError } from '../generated/contract';

type ErrorCode = ApiError['code'];

/** A failure the device reported, with its stable kind (7.24). */
export class DeviceError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DeviceError';
  }
}

/** The error a failed response carries; `fallback` when its body says nothing. */
export function deviceError(
  body: unknown,
  status: number,
  fallback: string,
): Error {
  const record =
    typeof body === 'object' && body !== null
      ? (body as { error?: unknown; code?: unknown })
      : {};
  const message =
    typeof record.error === 'string' && record.error ? record.error : fallback;
  return typeof record.code === 'string'
    ? new DeviceError(message, record.code as ErrorCode, status)
    : new Error(message);
}

/** The one recovery action that fits a failure, for a button beside it. */
export type Recovery = 'retry' | 'refresh' | 'unlock' | null;
export function errorRecovery(error: unknown): Recovery {
  if (!(error instanceof DeviceError)) return null;
  switch (error.code) {
    case 'conflict':
    case 'not_found':
      return 'refresh';
    case 'locked':
      return 'unlock';
    case 'busy':
    case 'timeout':
    case 'unavailable':
      return 'retry';
    default:
      return null;
  }
}

/** Plain causes for kinds whose device sentence may be terse. */
const byCode: Partial<Record<ErrorCode, string>> = {
  busy: 'Another change is still running on the device. Try again when it finishes.',
  locked: 'Protect is on. Turn Protect off to change this.',
  not_found: 'It is no longer on the device. Refresh to see what is there now.',
  timeout: 'The device took too long to answer. Try again in a moment.',
  storage:
    'Device storage is full or locked. Free space or unlock storage, then try again.',
};

const causes: [RegExp, string][] = [
  [
    /failed to fetch|networkerror|load failed|network request failed/i,
    'Oxidal is not reachable. Check the Wi-Fi or cable connection, then try again.',
  ],
  [/aborted|aborterror/i, 'The request was cancelled before it finished.'],
  [
    /changed; (refresh|review)|preview changed|expected revision|revision changed|stale/i,
    'Something changed on the device since this screen loaded. Check again, then retry.',
  ],
  [
    /incompatible/i,
    'This screen and the device software do not match. Reload the page.',
  ],
  [
    /storage is locked|unlock storage|read-only/i,
    'Device storage is locked. Unlock it in Settings → Device, then try again.',
  ],
  [
    /no space|disk full|enospc/i,
    'The device is out of storage space. Delete unused sounds, then try again.',
  ],
  [
    /timed out|timeout/i,
    'The device took too long to answer. Try again in a moment.',
  ],
  [
    /endpoint missing|audio device|no such device|not connected/i,
    'The audio interface is not available. Check its cable, then use Restart audio.',
  ],
];

/** The underlying message, without the `Error:` prefix, for a Details view. */
export function errorDetails(error: unknown): string {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';
  return text.replace(/^(Type)?Error:\s*/i, '').trim() || 'Unknown error';
}

/**
 * `action` is a short verb phrase such as "save this preset". Known causes get
 * a plain explanation; device messages that are already sentences pass through.
 */
export function friendlyError(error: unknown, action: string): string {
  const detail = errorDetails(error);
  const known = causes.find(([pattern]) => pattern.test(detail));
  const coded = error instanceof DeviceError ? byCode[error.code] : undefined;
  const reason = known
    ? known[1]
    : /^[A-Z].*[.!?]$/.test(detail)
      ? detail
      : (coded ?? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`);
  return `Could not ${action}. ${reason}`;
}
