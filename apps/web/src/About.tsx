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

import { Caption, Title } from '@oxidal/design-system/components/text';
import { STACK_CREDITS } from '@oxidal/design-system/lib/credits';
import { OXIDAL_EFFECTS } from '@oxidal/design-system/lib/oxidal-effects';
import { AboutPage } from '@oxidal/design-system/patterns/about-page';
import { BlockTile } from '@oxidal/design-system/widgets/block-tile';

import { capabilities } from './api';

type Health = Awaited<ReturnType<typeof capabilities>>;

const REPOSITORY = 'https://github.com/oxidalhq/oxidal';
const AGENTICFLOWX = 'https://github.com/AgenticFlowX/afx';

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
    <AboutPage
      credits={STACK_CREDITS.slice(0, 4)}
      madeWith={STACK_CREDITS.slice(4)}
      device={rows.map(([label, value]) => ({ label, value }))}
      author={
        <>
          Created and developed by <strong>Richard Sentino</strong>
        </>
      }
      footer={
        <div className="grid justify-items-center gap-3 border-t border-border pt-6 text-center">
          <Caption className="max-w-xl">
            Written in Rust, with a React interface, using{' '}
            <a
              href={AGENTICFLOWX}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline"
            >
              AgenticFlowX
            </a>{' '}
            spec-driven development: every feature starts as a spec, design and
            task list, and the code links back to them.
          </Caption>
          <nav
            className="flex flex-wrap justify-center gap-x-5 gap-y-3"
            aria-label="Oxidal links"
          >
            {[
              { name: 'Source code', href: REPOSITORY, Icon: GithubLogo },
              {
                name: 'Apache License 2.0',
                href: `${REPOSITORY}/blob/main/LICENSE`,
                Icon: Scales,
              },
              {
                name: 'Third-party licences',
                href: `${REPOSITORY}/blob/main/THIRD_PARTY.md`,
                Icon: Code,
              },
            ].map(({ name, href, Icon }) => (
              <a
                key={name}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-touch items-center gap-1 text-sm text-foreground underline"
              >
                <Icon aria-hidden="true" /> {name}
              </a>
            ))}
          </nav>
          <Caption className="text-xs">© 2026 Richard Sentino.</Caption>
        </div>
      }
    >
      <section aria-labelledby="about-features" className="grid gap-3">
        <Title as="h3" size="sm" id="about-features">
          What it does
        </Title>
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <li
              key={feature.title}
              className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2.5 gap-y-0.5"
            >
              <span
                className="row-span-2 grid size-8 place-items-center rounded-md bg-muted text-lg"
                aria-hidden="true"
              >
                {feature.icon}
              </span>
              <strong className="text-sm text-foreground">
                {feature.title}
              </strong>
              <Caption>{feature.text}</Caption>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="about-effects" className="grid gap-3">
        <Title
          as="h3"
          size="sm"
          id="about-effects"
          className="flex items-center gap-1.5"
        >
          <Sparkle aria-hidden="true" /> Oxidal effects
        </Title>
        <Caption>
          Bloom, Echo, Motion, Moment, Sustain, Fuzz and Wah are written in
          Rust. Hold and Swell are native plugins. Their algorithm references
          are documented with the source. Pitch uses a third-party engine.
        </Caption>
        <dl className="m-0 grid">
          {OXIDAL_EFFECTS.map((effect) => (
            <div
              key={effect.id}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-border py-2 sm:grid-cols-[auto_9rem_minmax(0,1fr)]"
            >
              <BlockTile
                glyph={effect.glyph}
                tinted
                className="row-span-2 sm:row-span-1"
              />
              <dt className="grid">
                <strong className="text-sm text-foreground">
                  {effect.name}
                </strong>
                <Caption as="span" className="text-xs">
                  {effect.kind}
                </Caption>
              </dt>
              <Caption as="dd" className="col-start-2 sm:col-start-3">
                {effect.summary}
              </Caption>
            </div>
          ))}
        </dl>
      </section>
    </AboutPage>
  );
}
