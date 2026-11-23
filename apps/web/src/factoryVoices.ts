/**
 * Factory amp voices. A voice is Oxidal's own name for a sound; it points at the
 * TONE3000 tone and model a player downloads on first use. Only numeric ids are
 * stored here, with Oxidal's own description of the sound: titles, creators,
 * licences and sizes are read live from TONE3000 when the player installs a
 * tone. No capture payload and no provider title ships with Oxidal.
 * @see docs/factory-collection.md
 */

type FactoryGain =
  'clean' | 'crunch' | 'lead' | 'high' | 'modern' | 'bass' | 'drive' | 'ir';

/** One suggested capture: a TONE3000 tone and one of its A2 models. A showcase
 * voice may leave the model open: the player picks it from the tone's A2 models
 * when the tone is installed, because model ids are only known to the provider. */
export type VoiceCapture = { tone: number; model?: number };

/** The A2 size a voice is built for. One A2 file packs both sizes, so a voice
 * lists the tiers the showcase builds it at. */
type VoiceTier = 'a2-lite' | 'a2-full';

export type FactoryVoice = {
  /** Plain description of the sound, never an artist, song or product name. */
  character: string;
  gain: FactoryGain;
  /** Never set: provider titles carry brand and person names, so labels use
   * `character`. Kept so callers that prefer a title fall back to it. */
  title?: undefined;
  /** 'ir' voices are cabinet or space IRs; they never count as a capture. */
  kind?: 'capture' | 'ir';
  /** A2 tiers the showcase builds this voice at; absent for older voices. */
  tiers?: readonly VoiceTier[];
  /** Ordered suggestions; the first is downloaded, the rest are alternatives. */
  captures: VoiceCapture[];
};

const voiceData = {
  // Older recipes use these roles. Each now has a concrete first-use download.
  clean: {
    character: 'Open, bell-like American combo clean',
    gain: 'clean',
    captures: [{ tone: 65227, model: 385845 }],
  },
  crunch: {
    character: 'Raw, dynamic fifty-watt stack crunch',
    gain: 'crunch',
    captures: [{ tone: 65578, model: 418470 }],
  },
  heavy: {
    character: 'Scooped, heavy, wide high-gain rhythm',
    gain: 'high',
    captures: [{ tone: 87866, model: 742072 }],
  },
  bass: {
    character: 'Warm, round vintage bass stack with a tight low end',
    gain: 'bass',
    captures: [{ tone: 55, model: 420126 }],
  },
  // Cleans.
  'blackface-clean': {
    tiers: ['a2-lite', 'a2-full'],
    character: 'Open, bell-like American combo clean',
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
    tiers: ['a2-lite', 'a2-full'],
    character: 'Raw, dynamic fifty-watt stack crunch',
    gain: 'crunch',
    captures: [{ tone: 65578, model: 418470 }],
  },
  'jcm-crunch': {
    character: 'Edge-of-breakup master-volume stack crunch',
    gain: 'crunch',
    captures: [{ tone: 44209, model: 567066 }],
  },
  'jcm-lead': {
    character: 'Saturated master-volume stack for rhythm and lead',
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
    tiers: ['a2-lite', 'a2-full'],
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
  // Bass.
  'bass-vintage': {
    character: 'Warm, round vintage bass stack with a tight low end',
    gain: 'bass',
    captures: [{ tone: 55, model: 420126 }],
  },
  'bass-grit': {
    character: 'Gritty, driven bass for rock and heavy parts',
    gain: 'bass',
    captures: [{ tone: 6371, model: 402188 }],
  },
  // TONE3000 showcase: amps and full rigs.
  'jc-clean': {
    character: 'Flat, fast solid-state clean for muted sixteenths',
    gain: 'clean',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 10912 }],
  },
  'two-rock-clean': {
    character: 'Wide, glassy boutique clean with deep headroom',
    gain: 'clean',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 104093 }],
  },
  'ac30-chime': {
    character: 'Chiming, jangly top boost combo at the edge of breakup',
    gain: 'crunch',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 82521 }],
  },
  'match-brave': {
    character: 'Shimmering class-A-style combo for pop and ambient',
    gain: 'clean',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 80592 }],
  },
  'super-reverb-77': {
    character: 'Open four-by-ten clean that takes a pedal well',
    gain: 'clean',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 19 }],
  },
  'super-reverb-65': {
    character: 'Clean that barks when played hard',
    gain: 'crunch',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 88775 }],
  },
  'tweed-crunch': {
    character: 'Raw, dynamic small-combo breakup',
    gain: 'crunch',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 90842 }],
  },
  'bluesbreaker-crunch': {
    character: 'Thick, vocal combo crunch',
    gain: 'crunch',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 77706 }],
  },
  'dumble-ods': {
    character: 'Smooth, singing overdrive amp with a round low end',
    gain: 'crunch',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 30435 }],
  },
  'jcm800-v30': {
    character: 'Hard-rock rhythm amp with its own cabinet',
    gain: 'lead',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 87735 }],
  },
  'friedman-be100': {
    character: 'Hot-rodded British stack with tight, modern gain',
    gain: 'lead',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 41359 }],
  },
  'peavey-5150-rig': {
    character: 'Aggressive, saturated high-gain rig with its own cabinet',
    gain: 'high',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 32868 }],
  },
  'stealth-5150-rig': {
    character: 'Three channels of modern metal in one rig',
    gain: 'modern',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 84864 }],
  },
  'rectifier-2025': {
    character: 'Scooped wall-of-sound head that needs a cabinet IR',
    gain: 'high',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 45026 }],
  },
  'badlander-head': {
    character: 'Tight, percussive low-tuned head that needs a cabinet IR',
    gain: 'modern',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 6298 }],
  },
  'vh4-high': {
    character: 'Tight, mid-forward high gain for progressive riffs',
    gain: 'high',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 89509 }],
  },
  'polytone-jazz': {
    character: 'Warm, round solid-state combo for jazz chords',
    gain: 'clean',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 56824 }],
  },
  'svt-head': {
    character: 'Round tube bass head that needs a cabinet IR',
    gain: 'bass',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 84925 }],
  },
  'darkglass-rig': {
    character: 'Modern driven bass with a tight, clear low end',
    gain: 'bass',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 27697 }],
  },
  // TONE3000 showcase: pedal captures, counted as captures.
  'drive-ts9': {
    character: 'Mid-pushed overdrive that tightens and thickens an amp',
    gain: 'drive',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 86314 }],
  },
  'drive-centaur': {
    character: 'Clean boost and light overdrive that adds bark to a combo',
    gain: 'drive',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 79454 }],
  },
  'drive-kot': {
    character: 'Transparent, amp-like overdrive that sings',
    gain: 'drive',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 87219 }],
  },
  'drive-sd1': {
    character: 'Tight, mid-forward boost for rhythm and solos',
    gain: 'drive',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 87914 }],
  },
  'drive-fortin': {
    character: 'Tight boost that keeps low-tuned rhythm focused',
    gain: 'drive',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 88644 }],
  },
  'drive-sansamp': {
    character: 'Gritty bass driver DI for a tube amp',
    gain: 'drive',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 31010 }],
  },
  'drive-morning-glory': {
    character: 'Light, open overdrive for snappy twang',
    gain: 'drive',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 75764 }],
  },
  // TONE3000 showcase: cabinet IRs. They do not count as captures.
  'ir-deluxe': {
    character: 'One-by-twelve combo cabinet impulse',
    gain: 'ir',
    kind: 'ir',
    captures: [{ tone: 27465 }],
  },
  'ir-mesa-os': {
    character: 'Oversized four-by-twelve metal cabinet impulse',
    gain: 'ir',
    kind: 'ir',
    captures: [{ tone: 84863 }],
  },
  'ir-ampeg-810': {
    character: 'Eight-by-ten bass cabinet impulse',
    gain: 'ir',
    kind: 'ir',
    captures: [{ tone: 1708 }],
  },
} as const satisfies Record<string, FactoryVoice>;

export type FactoryVoiceId = keyof typeof voiceData;

/** Widened to `FactoryVoice` so `capture.model` is `number | undefined`. */
export const factoryVoices: Record<FactoryVoiceId, FactoryVoice> = voiceData;

export const factoryVoiceIds = Object.keys(factoryVoices) as FactoryVoiceId[];

export function isFactoryVoice(id: string): id is FactoryVoiceId {
  return Object.hasOwn(factoryVoices, id);
}

/** The capture a "Download" tap fetches first. */
export function primaryCapture(id: FactoryVoiceId): VoiceCapture {
  return factoryVoices[id].captures[0]!;
}
