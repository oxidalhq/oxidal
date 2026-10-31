import type { LocalModel } from './api';

export function modelSourceLink(model: LocalModel) {
  try {
    const url = new URL(model.nam?.source_url ?? '');
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      /^(www\.)?tone3000\.com$/.test(url.hostname)
    )
      return url.href;
  } catch {
    /* Optional uploaded source reference. */
  }
  return null;
}

export function modelToneId(model: LocalModel) {
  if (model.tone_id) return model.tone_id;
  if (model.nam?.source_tone_id) return model.nam.source_tone_id;
  try {
    const url = new URL(modelSourceLink(model) ?? '');
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      /^(www\.)?tone3000\.com$/.test(url.hostname)
    ) {
      const id = /^\/tones\/(\d+)\/?$/.exec(url.pathname)?.[1];
      if (id && Number.isSafeInteger(Number(id)) && Number(id) > 0)
        return Number(id);
    }
  } catch {
    /* No verified provider address in this upload. */
  }
  return null;
}
