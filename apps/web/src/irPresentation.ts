import type { LocalModel } from './api';

/** Display known capture naming without guessing microphone makes or distances.
 * Unrecognized libraries keep their own names. @see docs/library.md
 */
export function presentIr(model: LocalModel) {
  const folders = model.folder?.split('/') ?? [];
  const pack = folders.find((p) => /\bImpulse Responses\b/i.test(p));
  const cabinet = pack
    ? pack
        .replace(/\s+Impulse Responses.*$/i, '')
        .replace(/^Boutique Tones\s+/i, '')
        .replace(/^412\s+/, '4×12 ')
        .replace(/\s+Cab\s+/, ' · ')
    : folders.at(-1)
      ? `Folder: ${folders.at(-1)}`
      : model.tone_id
        ? model.title
        : 'Imported IRs';
  const knownPack = pack?.startsWith('Boutique Tones 412 Mezzabarba MZero');
  const capture = knownPack
    ? /^412-MZB-MZERO69-G(?:12|1)M25_(?:(\d+[A-Z]*)_([ABC])_(\d{2})_(ON-AXIS|ANGLE-(\d+))|MIX-(\d+))$/i.exec(
        model.name.replace(/\.wav$/i, ''),
      )
    : null;
  const title = capture
    ? capture[6]
      ? `Mix ${Number(capture[6])}`
      : `Mic ${capture[1]} · Position ${capture[2]}${capture[3]} · ${capture[4] === 'ON-AXIS' ? 'On-axis' : `${capture[5]}°`}`
    : model.title.replace(/_/g, ' ');
  const audio = model.audio;
  const technical = audio
    ? `${audio.sample_rate / 1000} kHz · ${audio.bits_per_sample}-bit${audio.floating_point ? ' float' : ''} · ${audio.channels === 1 ? 'Mono' : audio.channels === 2 ? 'Stereo' : `${audio.channels} channels`} · ${Math.round(audio.duration_ms)} ms`
    : 'WAV details unavailable';
  return {
    key: pack ? folders.slice(0, folders.indexOf(pack) + 1).join('/') : cabinet,
    cabinet,
    collection: pack ? (folders[folders.indexOf(pack) - 1] ?? '') : '',
    title,
    technical,
  };
}

export function groupIrs(models: LocalModel[]) {
  const groups = new Map<
    string,
    {
      key: string;
      cabinet: string;
      collection: string;
      files: { model: LocalModel; title: string; technical: string }[];
    }
  >();
  for (const model of models) {
    const info = presentIr(model);
    let group = groups.get(info.key);
    if (!group) {
      group = {
        key: info.key,
        cabinet: info.cabinet,
        collection: info.collection,
        files: [],
      };
      groups.set(info.key, group);
    }
    group.files.push({ model, title: info.title, technical: info.technical });
  }
  return [...groups.values()];
}
