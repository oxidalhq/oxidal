/**
 * One sentence a player can act on: what failed, the cause in plain words and,
 * where known, what to do next. Raw `Error: …` strings never reach the screen;
 * the original text stays available through `errorDetails` for Details.
 * @see docs/interface.md
 */
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
  const reason = known
    ? known[1]
    : /^[A-Z].*[.!?]$/.test(detail)
      ? detail
      : `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`;
  return `Could not ${action}. ${reason}`;
}
