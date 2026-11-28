import { type ReactNode, useEffect, useRef, useState } from 'react';

import type { ChainCanvasControl } from '../lib/chain-canvas-control';
import { PageHeading } from '../patterns/app-shell';
import type { BarLevels } from '../patterns/display-bar';
import { OPEN_HEADER_HEIGHT, OpenHeader } from '../patterns/open-header';
import { ChainBarRigSample } from '../patterns/rig-chain-bar.demo';
import { PRESETS } from '../patterns/rig-samples.data';
import {
  PresetRow,
  RigBottomTabs,
  type RigDestination,
} from '../patterns/rig-top-bar';
import type { ResourceReadings } from '../widgets/resource-strip';
import { Guitars } from './guitars';
import { Levels } from './levels';
import { Library } from './library';
import { Settings } from './settings';

/**
 * The open header over the Rig and over four other pages. The chain map runs
 * from the top of the window, under the header; the preset floats over the
 * map's top-left like a product title. Design samples with fixed example
 * data; nothing is saved.
 */

const LEVELS: BarLevels = { input: [-14, -16], output: [-9, -10] };
const READINGS: ResourceReadings = {
  dsp: { p95: 0.21, peak: 0.34 },
  cpu: 18,
  ram: { used: 820, total: 8064 },
  xruns: 0,
  clips: 0,
  temperature: 52,
};

/** The header, the floating preset and the fade under them, over the chain map. */
function RigOverlay({
  canvas,
  scene,
  changed,
  discard,
  panned,
}: {
  canvas: ChainCanvasControl;
  scene: string;
  changed: boolean;
  discard: () => void;
  panned: boolean;
}) {
  const [where, setWhere] = useState<RigDestination>('rig');
  const [preset, setPreset] = useState(0);
  const [muted, setMuted] = useState(false);
  const [locked, setLocked] = useState(false);
  const name = PRESETS[preset]!;
  // Show the panned state: zoom in once the map has drawn.
  const control = useRef(canvas);
  useEffect(() => {
    control.current = canvas;
  });
  useEffect(() => {
    if (!panned) return;
    const first = setTimeout(() => control.current.zoomIn(), 400);
    // Then drag the chain up, as a player would, so it runs under the header.
    const second = setTimeout(() => control.current.panBy(0, -160), 800);
    return () => {
      clearTimeout(first);
      clearTimeout(second);
    };
  }, [panned]);
  return (
    <>
      {/* A short fade from the page colour keeps the header and preset readable over the map. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32 bg-linear-to-b from-background via-background/80 to-transparent md:h-36 [[data-display=epaper]_&]:hidden"
      />
      <OpenHeader
        className="absolute inset-x-0 top-0"
        destination={where}
        onNavigate={setWhere}
        levels={LEVELS}
        readings={READINGS}
        onSearch={() => undefined}
        solid={canvas.drawingTop < OPEN_HEADER_HEIGHT}
      />
      <PresetRow
        variant="float"
        // Just under the header.
        className="absolute inset-x-0 top-14 z-10"
        name={name}
        shortName={name.replace(/^Oxidal · /, '')}
        subtitle={`${scene} · Default`}
        presets={PRESETS}
        onPick={(p) => setPreset(PRESETS.indexOf(p))}
        previousName={PRESETS[preset - 1]}
        nextName={PRESETS[preset + 1]}
        onPrevious={preset > 0 ? () => setPreset(preset - 1) : undefined}
        onNext={
          preset < PRESETS.length - 1 ? () => setPreset(preset + 1) : undefined
        }
        muted={muted}
        onMute={setMuted}
        onSearch={() => undefined}
        onTuner={() => undefined}
        onPerform={() => undefined}
        protectedPreset={locked}
        onProtect={setLocked}
        onStopAudio={() => undefined}
        onDiscard={changed ? discard : undefined}
      />
    </>
  );
}

/** The Rig with the open header: the chain starts at the top of the window. */
export function OpenRigSample({ panned = false }: { panned?: boolean }) {
  const [where, setWhere] = useState<RigDestination>('rig');
  return (
    <ChainBarRigSample
      edits="edited"
      // Header and preset stay clear of the chain when it fits.
      insetTop={136}
      header={({ canvas, scene, changed, discard }) => (
        <RigOverlay
          canvas={canvas}
          scene={scene}
          changed={changed}
          discard={discard}
          panned={panned}
        />
      )}
      footer={<RigBottomTabs destination={where} onNavigate={setWhere} />}
    />
  );
}

const PAGES: Record<
  'settings' | 'library' | 'levels' | 'guitars',
  { eyebrow: string; title: string; caption: string; body: ReactNode }
> = {
  settings: {
    eyebrow: 'This unit',
    title: 'Settings',
    caption: 'Audio, MIDI, network, display and the device itself.',
    body: <Settings section="audio" />,
  },
  library: {
    eyebrow: 'On this unit',
    title: 'Library',
    caption: 'Your presets, Oxidal sounds, set lists, tones and stems.',
    body: <Library section="mine" />,
  },
  levels: {
    eyebrow: 'Loudness',
    title: 'Levels',
    caption: 'Sound check and readings for every preset.',
    body: <Levels />,
  },
  guitars: {
    eyebrow: 'Your instruments',
    title: 'Guitars',
    caption: 'Guitars and pickups, so each preset plays at the right level.',
    body: <Guitars />,
  },
};

/** Another page under the open header: a large title, then the page itself. */
export function OpenPageSample({
  page,
}: {
  page: 'settings' | 'library' | 'levels' | 'guitars';
}) {
  const [where, setWhere] = useState<RigDestination>(page);
  const [scrolled, setScrolled] = useState(false);
  const { eyebrow, title, caption, body } = PAGES[page];
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <div
        data-slot="open-page"
        className="relative min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
      >
        <OpenHeader
          className="sticky top-0 -mb-14"
          destination={where}
          onNavigate={setWhere}
          levels={LEVELS}
          readings={READINGS}
          onSearch={() => undefined}
          solid={scrolled}
        />
        <main style={{ paddingTop: OPEN_HEADER_HEIGHT }}>
          <PageHeading
            size="lg"
            eyebrow={eyebrow}
            title={title}
            caption={caption}
            className="pt-6 pb-4"
          />
          {/* The page's own small heading gives way to the large one. */}
          <div className="[&_[data-slot=page-heading]]:hidden">{body}</div>
        </main>
      </div>
      <RigBottomTabs destination={where} onNavigate={setWhere} />
    </div>
  );
}
