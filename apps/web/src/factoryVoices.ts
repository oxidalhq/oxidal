/**
 * Factory amp voices. A voice is Oxidal's own name for a sound; it points at the
 * TONE3000 tone and model a player downloads on first use. Only numeric ids are
 * stored here: titles, creators, licences and sizes are read live from TONE3000 and
 * shown as the provider presents them. No capture payload ships with Oxidal.
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
  /** The tone's own TONE3000 title, shown only as the user's tone. Optional
   * because the title is also read live; set where the research recorded it. */
  title?: string;
  /** 'ir' voices are cabinet or space IRs; they never count as a capture. */
  kind?: 'capture' | 'ir';
  /** A2 tiers the showcase builds this voice at; absent for older voices. */
  tiers?: readonly VoiceTier[];
  /** Ordered suggestions; the first is downloaded, the rest are alternatives. */
  captures: VoiceCapture[];
};

const voiceData = {
  // Cleans.
  'blackface-clean': {
    tiers: ['a2-lite', 'a2-full'],
    title: 'Fender Deluxe Reverb (A2)',
    character: 'Open, bell-like blackface-style clean',
    gain: 'clean',
    captures: [{ tone: 65227, model: 385845 }],
  },
  'studio-clean': {
    title: 'Mesa Boogie Mark VII',
    character: 'Bright, tight modern clean with headroom',
    gain: 'clean',
    captures: [{ tone: 62659, model: 576000 }],
  },
  'chime-clean': {
    title: 'Soldano SLO 100',
    character: 'Glassy clean with a firm low end',
    gain: 'clean',
    captures: [{ tone: 46269, model: 569128 }],
  },
  // Classic crunch and lead.
  'plexi-crunch': {
    tiers: ['a2-lite', 'a2-full'],
    title: 'Marshall JMP-50 Lead 1969 Plexi A2',
    character: 'Plexi-style crunch, raw and dynamic',
    gain: 'crunch',
    captures: [{ tone: 65578, model: 418470 }],
  },
  'jcm-crunch': {
    title: 'Marshall JCM800 2203 Modified',
    character: 'Edge-of-breakup 800-style crunch',
    gain: 'crunch',
    captures: [{ tone: 44209, model: 567066 }],
  },
  'jcm-lead': {
    title: 'Marshall JCM800 2203 Modified',
    character: 'Saturated 800-style rhythm and lead',
    gain: 'lead',
    captures: [
      { tone: 44209, model: 567067 },
      { tone: 44209, model: 567061 },
    ],
  },
  'mark-crunch': {
    title: 'Mesa Boogie Mark VII',
    character: 'Tight, thick boutique crunch',
    gain: 'crunch',
    captures: [{ tone: 62659, model: 575999 }],
  },
  'mark-lead': {
    title: 'Mesa Boogie Mark VII',
    character: 'Compressed, singing lead with a tight low end',
    gain: 'lead',
    captures: [{ tone: 62659, model: 576006 }],
  },
  'slo-crunch': {
    tiers: ['a2-lite', 'a2-full'],
    title: 'Soldano SLO 100',
    character: 'Dense, articulate crunch',
    gain: 'crunch',
    captures: [{ tone: 46269, model: 569132 }],
  },
  'slo-lead': {
    title: 'Soldano SLO 100',
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
    title: 'Mesa 90s Dual Rectifier RI - Red Modern FULL RIG',
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
  // TONE3000 showcase: amps and full rigs. Titles are the tones' own titles.
  'jc-clean': {
    title: 'Roland JC 120B Jazz Chorus',
    character: 'Flat, fast solid-state clean for muted sixteenths',
    gain: 'clean',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 10912 }],
  },
  'two-rock-clean': {
    title: 'Two-Rock SSS - Ultimate Clean',
    character: 'Wide, glassy boutique clean with deep headroom',
    gain: 'clean',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 104093 }],
  },
  'ac30-chime': {
    title: '1964 VOX AC30 Top Boost Super Twin - Edge of Breakup - A2',
    character: 'Chiming, jangly top boost combo at the edge of breakup',
    gain: 'crunch',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 82521 }],
  },
  'match-brave': {
    title: '1997 Match Brave 2x12',
    character: 'Shimmering class-A-style combo for pop and ambient',
    gain: 'clean',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 80592 }],
  },
  'super-reverb-77': {
    title: 'Fender Super Reverb 1977',
    character: 'Open four-by-ten clean that takes a pedal well',
    gain: 'clean',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 19 }],
  },
  'super-reverb-65': {
    title: 'Fender Super Reverb 1965 - Edge of Breakup - A2',
    character: 'Clean that barks when played hard',
    gain: 'crunch',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 88775 }],
  },
  'tweed-crunch': {
    title: 'Fender Tweed Deluxe 5E3 1957 - Crunch - A2',
    character: 'Raw, dynamic small-combo breakup',
    gain: 'crunch',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 90842 }],
  },
  'bluesbreaker-crunch': {
    title: '1966 Marshall 1962 Bluesbreaker (JTM45) - CRUNCH - A2',
    character: 'Thick, vocal combo crunch',
    gain: 'crunch',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 77706 }],
  },
  'dumble-ods': {
    title: 'Dumble ODS #102 Ford Hyper Accuracy+',
    character: 'Smooth, singing overdrive amp with a round low end',
    gain: 'crunch',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 30435 }],
  },
  'jcm800-v30': {
    title: 'Marshall Jcm800 + V30 1960',
    character: 'Hard-rock rhythm amp with its own cabinet',
    gain: 'lead',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 87735 }],
  },
  'friedman-be100': {
    title: 'Friedman BE100 Deluxe',
    character: 'Hot-rodded British stack with tight, modern gain',
    gain: 'lead',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 41359 }],
  },
  'peavey-5150-rig': {
    title: 'Full Rig Peavey 5150 + Mesa 4x12',
    character: 'Aggressive, saturated high-gain rig with its own cabinet',
    gain: 'high',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 32868 }],
  },
  'stealth-5150-rig': {
    title: '5150 Stealth 100w Mesa OS Full Rig - Blue, Red and Green',
    character: 'Three channels of modern metal in one rig',
    gain: 'modern',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 84864 }],
  },
  'rectifier-2025': {
    title: 'MESA DUAL RECTIFIER 2025',
    character: 'Scooped wall-of-sound head that needs a cabinet IR',
    gain: 'high',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 45026 }],
  },
  'badlander-head': {
    title: 'Mesa Boogie Badlander Rectifier 100W EL34 (SignalArt reamp)',
    character: 'Tight, percussive low-tuned head that needs a cabinet IR',
    gain: 'modern',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 6298 }],
  },
  'vh4-high': {
    title: 'Diezel VH4 Channel III - High Gain - A2',
    character: 'Tight, mid-forward high gain for progressive riffs',
    gain: 'high',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 89509 }],
  },
  'polytone-jazz': {
    title: 'Polytone Mini Brute III 15" (Jazz Only)',
    character: 'Warm, round solid-state combo for jazz chords',
    gain: 'clean',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 56824 }],
  },
  'svt-head': {
    title: 'AMPEG SVT CL (GAIN STAGES)',
    character: 'Round tube bass head that needs a cabinet IR',
    gain: 'bass',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 84925 }],
  },
  'darkglass-rig': {
    title: 'Darkglass Alpha Omega',
    character: 'Modern driven bass with a tight, clear low end',
    gain: 'bass',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 27697 }],
  },
  // TONE3000 showcase: pedal captures, counted as captures.
  'drive-ts9': {
    title: 'Ibanez TS9 Tube Screamer',
    character: 'Mid-pushed overdrive that tightens and thickens an amp',
    gain: 'drive',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 86314 }],
  },
  'drive-centaur': {
    title: 'Centaur Overdrive',
    character: 'Clean boost and light overdrive that adds bark to a combo',
    gain: 'drive',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 79454 }],
  },
  'drive-kot': {
    title: 'KOT',
    character: 'Transparent, amp-like overdrive that sings',
    gain: 'drive',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 87219 }],
  },
  'drive-sd1': {
    title: 'Boss SD-1 Super Overdrive',
    character: 'Tight, mid-forward boost for rhythm and solos',
    gain: 'drive',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 87914 }],
  },
  'drive-fortin': {
    title: 'Fortin Modded TS-9 Tube Screamer',
    character: 'Tight boost that keeps low-tuned rhythm focused',
    gain: 'drive',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 88644 }],
  },
  'drive-sansamp': {
    title: 'TECH21 Sansamp Bass Driver',
    character: 'Gritty bass driver DI for a tube amp',
    gain: 'drive',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 31010 }],
  },
  'drive-morning-glory': {
    title: 'JHS Morning Glory V4',
    character: 'Light, open overdrive for snappy twang',
    gain: 'drive',
    tiers: ['a2-lite', 'a2-full'],
    captures: [{ tone: 75764 }],
  },
  // TONE3000 showcase: cabinet IRs. They do not count as captures.
  'ir-deluxe': {
    title: 'Fender Deluxe Reverb Mix Ready',
    character: 'One-by-twelve combo cabinet impulse',
    gain: 'ir',
    kind: 'ir',
    captures: [{ tone: 27465 }],
  },
  'ir-mesa-os': {
    title: 'Mesa Oversized 4x12 V30',
    character: 'Oversized four-by-twelve metal cabinet impulse',
    gain: 'ir',
    kind: 'ir',
    captures: [{ tone: 84863 }],
  },
  'ir-ampeg-810': {
    title: 'Bass Ampeg SVT 8x10',
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
