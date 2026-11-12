import type { TonePage } from './api';

type Tone = TonePage['data'][number];

/** The tone's page, only ever on TONE3000 over HTTPS: the address comes from a web API. */
export function toneLink(tone: Pick<Tone, 'id' | 'url'>) {
  try {
    const url = new URL(tone.url);
    if (
      url.protocol === 'https:' &&
      (url.hostname === 'tone3000.com' ||
        url.hostname.endsWith('.tone3000.com'))
    )
      return url.href;
  } catch {
    /* Fall through to the tone's own page. */
  }
  return `https://www.tone3000.com/tones/${tone.id}`;
}
