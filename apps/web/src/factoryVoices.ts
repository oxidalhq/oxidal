/**
 * Factory amp voices. A voice is Oxidal's own name for a sound; it points at the
 * TONE3000 tone and model a player downloads on first use. Only numeric ids are
 * stored here: titles, creators, licences and sizes are read live from TONE3000 and
 * shown as the provider presents them. No capture payload ships with Oxidal.
 * @see docs/factory-collection.md
 */

export type FactoryGain =
  'clean' | 'crunch' | 'lead' | 'high' | 'modern' | 'bass';

/** One suggested capture: a TONE3000 tone and one of its A2 models. */
export type VoiceCapture = { tone: number; model: number };

export type FactoryVoice = {
  /** Plain description of the sound, never an artist, song or product name. */
  character: string;
  gain: FactoryGain;
  /** Ordered suggestions; the first is downloaded, the rest are alternatives. */
  captures: VoiceCapture[];
};

export const factoryVoices = {
  // Cleans.
  'blackface-clean': {
    character: 'Open, bell-like blackface-style clean',
    gain: 'clean',
    captures: [{ tone: 65227, model: 385845 }],
  },
  'studio-clean': {
    character: 'Bright, tight modern clean with headroom',
    gain: 'clean',
    captures: [{ tone: 62659, model: 576000 }],
  },
  'chime-clean': {
    character: 'Glassy clean with a firm low end',
    gain: 'clean',
    captures: [{ tone: 46269, model: 569128 }],
  },
  // Classic crunch and lead.
  'plexi-crunch': {
    character: 'Plexi-style crunch, raw and dynamic',
    gain: 'crunch',
    captures: [{ tone: 65578, model: 418470 }],
  },
  'jcm-crunch': {
    character: 'Edge-of-breakup 800-style crunch',
    gain: 'crunch',
    captures: [{ tone: 44209, model: 567066 }],
  },
  'jcm-lead': {
    character: 'Saturated 800-style rhythm and lead',
    gain: 'lead',
    captures: [
      { tone: 44209, model: 567067 },
      { tone: 44209, model: 567061 },
    ],
  },
  'mark-crunch': {
    character: 'Tight, thick boutique crunch',
    gain: 'crunch',
    captures: [{ tone: 62659, model: 575999 }],
  },
  'mark-lead': {
    character: 'Compressed, singing lead with a tight low end',
    gain: 'lead',
    captures: [{ tone: 62659, model: 576006 }],
  },
  'slo-crunch': {
    character: 'Dense, articulate crunch',
    gain: 'crunch',
    captures: [{ tone: 46269, model: 569132 }],
  },
  'slo-lead': {
    character: 'Smooth, creamy lead',
    gain: 'lead',
    captures: [{ tone: 46269, model: 569130 }],
  },
  // High gain and modern.
  'hotrod-high': {
    character: 'Fast, aggressive high-gain stack',
    gain: 'high',
    captures: [
      { tone: 76505, model: 689926 },
      { tone: 76505, model: 668482 },
    ],
  },
  'rectifier-high': {
    character: 'Scooped, heavy, wide high-gain rhythm',
    gain: 'high',
    captures: [
      { tone: 87866, model: 742072 },
      { tone: 87866, model: 742074 },
    ],
  },
  'modern-dark': {
    character: 'Modern high gain with a dark top end',
    gain: 'modern',
    captures: [{ tone: 105859, model: 869525 }],
  },
  'modern-bright': {
    character: 'Modern high gain with cutting top end',
    gain: 'modern',
    captures: [{ tone: 105859, model: 869614 }],
  },
  'modern-scooped': {
    character: 'Modern high gain with scooped mids for tight low-tuned rhythm',
    gain: 'modern',
    captures: [{ tone: 105859, model: 869621 }],
  },
  'modern-tight': {
    character: 'Modern high gain with the low end pulled out',
    gain: 'modern',
    captures: [
      { tone: 105859, model: 869866 },
      { tone: 105859, model: 869915 },
    ],
  },
} as const satisfies Record<string, FactoryVoice>;

export type FactoryVoiceId = keyof typeof factoryVoices;

export const factoryVoiceIds = Object.keys(factoryVoices) as FactoryVoiceId[];

export function isFactoryVoice(id: string): id is FactoryVoiceId {
  return Object.hasOwn(factoryVoices, id);
}

/** The capture a "Download" tap fetches first. */
export function primaryCapture(id: FactoryVoiceId): VoiceCapture {
  return factoryVoices[id].captures[0];
}
