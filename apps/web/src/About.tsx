import {
  Code,
  GithubLogo,
  Metronome,
  Microphone,
  MusicNotes,
  Plug,
  Scales,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  SpeakerHifi,
} from '@phosphor-icons/react';
import { type ReactNode, useEffect, useState } from 'react';

import { capabilities } from './api';

type Health = Awaited<ReturnType<typeof capabilities>>;

const REPOSITORY = 'https://github.com/oxidalhq/oxidal';
const AGENTICFLOWX = 'https://github.com/AgenticFlowX/afx';

/**
 * Credits as clickable badges with each project's own logo, from
 * `/brand/credits/` (sources in THIRD_PARTY.md). `mono` logos are drawn in
 * the badge's ink.
 */
const CREDITS: {
  role: string;
  name: string;
  href: string;
  logo: string;
  mono?: boolean;
  /** The logo already spells the name. */
  wordmark?: boolean;
}[] = [
  {
    role: 'Built with',
    name: 'Rust',
    href: 'https://www.rust-lang.org',
    logo: 'rust.svg',
    mono: true,
  },
  {
    role: 'Powered by',
    name: 'TONE3000',
    href: 'https://www.tone3000.com',
    logo: 'tone3000.svg',
    wordmark: true,
  },
  {
    role: 'Powered by',
    name: 'NAM',
    href: 'https://www.neuralampmodeler.com',
    logo: 'nam.png',
  },
  {
    role: 'Built with',
    name: 'AgenticFlowX',
    href: AGENTICFLOWX,
    logo: 'agenticflowx.svg',
  },
];

/** Oxidal's own effects: original code from published research. */
const EFFECTS: { name: string; kind: string; detail: string }[] = [
  {
    name: 'Bloom',
    kind: 'Reverb',
    detail: 'Room, Hall, Plate, Spring, Cloud, Bloom, Shimmer and Nonlinear',
  },
  {
    name: 'Echo',
    kind: 'Delay',
    detail: 'Digital, Tape, Heads, Bucket, Reverse, Duck, Filter and Ping',
  },
  {
    name: 'Motion',
    kind: 'Modulation',
    detail:
      'Chorus, Flanger, Phaser, Vibe, Rotary, Tremolo, Harmonic tremolo, Vibrato and Ring',
  },
  {
    name: 'Moment',
    kind: 'Micro-looper',
    detail:
      'Keeps what you just played as a loop to slow, reverse, stretch or smear',
  },
  {
    name: 'Sustain',
    kind: 'Sustainer',
    detail: 'Holds each note at a steady level; Normal, Harmonic and Mix',
  },
  {
    name: 'Hold',
    kind: 'Freeze',
    detail: 'Keeps what you play ringing as a drone while you play over it',
  },
  {
    name: 'Swell',
    kind: 'Auto-swell',
    detail: 'Fades each note in, like a volume pedal worked by your playing',
  },
  {
    name: 'Pitch',
    kind: 'Pitch shift',
    detail:
      '±24 semitones anywhere in a preset. A port of the TONE3000 pitch engine, credited in its notice.',
  },
];

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: <SpeakerHifi aria-hidden="true" />,
    title: 'Amp and cabinet modeling',
    text: 'Neural Amp Modeler captures for amps, cabinets and full rigs, with impulse responses.',
  },
  {
    icon: <Plug aria-hidden="true" />,
    title: 'LV2 effects',
    text: 'A qualified set of drives, fuzzes, compressors, filters, delays and reverbs.',
  },
  {
    icon: <SlidersHorizontal aria-hidden="true" />,
    title: 'Rigs, scenes and Set list',
    text: 'Presets with scenes, a Set list for the gig and MIDI recall from your foot controller.',
  },
  {
    icon: <MusicNotes aria-hidden="true" />,
    title: 'Backing tracks and stems',
    text: 'Play songs over your rig, split them into stems and mute or level each part as it plays.',
  },
  {
    icon: <Metronome aria-hidden="true" />,
    title: 'Practice tools',
    text: 'A–B loops, slower or faster playback that keeps pitch, and a click that follows the song.',
  },
  {
    icon: <Microphone aria-hidden="true" />,
    title: 'DI recording and reamp',
    text: 'Record your dry guitar and play it back through any rig to try new sounds.',
  },
  {
    icon: <ShieldCheck aria-hidden="true" />,
    title: 'On your device',
    text: 'Sounds, settings and recordings stay on the device. Playing needs no account or internet.',
  },
];

/**
 * About: what Oxidal is, what it does, what this device reports, how it is
 * built, its licence and its author. Unknown device values say so.
 * @see docs/interface.md
 */
export function About() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    capabilities()
      .then((value) => {
        if (active) setHealth(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const unknown = failed ? 'Unavailable' : 'Reading…';
  const rows: [string, string][] = [
    ['Version', health?.version ?? unknown],
    [
      'Audio',
      health
        ? health.audio_available
          ? 'Available'
          : 'Not available'
        : unknown,
    ],
    ['MIDI', health?.midi_transport ?? unknown],
    [
      'TONE3000 engine',
      health ? (health.native_editor ? 'Installed' : 'Not installed') : unknown,
    ],
  ];
  return (
    <section className="about-oxidal" aria-labelledby="about-oxidal-title">
      <header className="about-hero">
        <span className="brand-wordmark about-wordmark" aria-hidden="true" />
        <h2 id="about-oxidal-title" className="sr-only">
          About Oxidal
        </h2>
        <p className="about-byline">
          Created and developed by <strong>Richard Sentino</strong>
        </p>
        <p className="about-kind">
          Multi-effects amp modeler · guitar and bass
        </p>
        <p className="about-lead">
          Turn a Raspberry Pi 5 and your audio interface into a complete guitar
          and bass rig: amps, cabinets and effects in presets with scenes,
          played from this browser.
        </p>
        {health?.version && (
          <span className="about-version">Version {health.version}</span>
        )}
        <ul className="about-credits" aria-label="Credits">
          {CREDITS.map((credit) => (
            <li key={credit.name}>
              <a
                className="about-credit"
                href={credit.href}
                target="_blank"
                rel="noreferrer"
                aria-label={`${credit.role} ${credit.name}`}
              >
                <span className="about-credit-role">{credit.role}</span>
                <span className="about-credit-brand">
                  {credit.mono ? (
                    <span
                      className="about-credit-logo"
                      data-mono=""
                      style={{
                        maskImage: `url(/brand/credits/${credit.logo})`,
                      }}
                    />
                  ) : (
                    <img
                      className="about-credit-logo"
                      data-wordmark={credit.wordmark ? '' : undefined}
                      src={`/brand/credits/${credit.logo}`}
                      alt=""
                    />
                  )}
                  {!credit.wordmark && (
                    <span className="about-credit-mark">{credit.name}</span>
                  )}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </header>

      <section aria-labelledby="about-features">
        <h3 id="about-features">What it does</h3>
        <ul className="about-feature-grid">
          {FEATURES.map((feature) => (
            <li key={feature.title}>
              <span className="about-feature-icon">{feature.icon}</span>
              <strong>{feature.title}</strong>
              <span>{feature.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="about-effects">
        <h3 id="about-effects">
          <Sparkle aria-hidden="true" /> Oxidal effects
        </h3>
        <p className="about-effects-intro">
          Bloom, Echo, Motion and Sustain are safe Rust, and Hold and Swell
          native plugins, all written for Oxidal from published research and its
          own code. Pitch is a port of a third-party engine.
        </p>
        <dl className="about-effects">
          {EFFECTS.map((effect) => (
            <div key={effect.name}>
              <dt>
                <strong>{effect.name}</strong>
                <span className="caption">{effect.kind}</span>
              </dt>
              <dd>{effect.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="about-device">
        <h3 id="about-device">This device</h3>
        <dl className="about-facts">
          {rows.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="about-footer">
        <span className="about-footer-mark" aria-hidden="true" />
        <p>
          Written in Rust, with a React interface, using{' '}
          <a href={AGENTICFLOWX} target="_blank" rel="noreferrer">
            AgenticFlowX
          </a>{' '}
          spec-driven development: every feature starts as a spec, design and
          task list, and the code links back to them.
        </p>
        <nav className="about-footer-links" aria-label="Oxidal links">
          <a href={REPOSITORY} target="_blank" rel="noreferrer">
            <GithubLogo aria-hidden="true" /> Source code
          </a>
          <a
            href={`${REPOSITORY}/blob/main/LICENSE`}
            target="_blank"
            rel="noreferrer"
          >
            <Scales aria-hidden="true" /> Apache License 2.0
          </a>
          <a
            href={`${REPOSITORY}/blob/main/THIRD_PARTY.md`}
            target="_blank"
            rel="noreferrer"
          >
            <Code aria-hidden="true" /> Third-party licences
          </a>
        </nav>
        <p className="about-footer-fine">
          © 2026 Richard Sentino. Open source under the Apache License 2.0; some
          optional native components use separately licensed dependencies. The
          Oxidal name and logo are not covered by the licence.
        </p>
      </div>
    </section>
  );
}
