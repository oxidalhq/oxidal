import { useEffect, useState } from 'react';
import { capabilities } from './api';

type Health = Awaited<ReturnType<typeof capabilities>>;

/**
 * About (Sprint 07 7.18): a normal Settings page with what this device really
 * reports. Unknown values say so instead of being guessed.
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
      <h2 id="about-oxidal-title">Oxidal</h2>
      <p>
        An open guitar and bass processor for a Raspberry Pi 5 or similar board
        and your own audio interface. It plays NAM captures, impulse responses
        and LV2 effects in presets with scenes, controlled from this browser.
        Your sounds and settings stay on the device.
      </p>
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
      <p className="caption">
        Full and Lite A2 models can be mixed per block. Scenes recall prepared
        branch mixes without rebuilding the sound.
      </p>
      <section className="about-author" aria-labelledby="about-author">
        <h3 id="about-author">Created and developed by</h3>
        <p>Richard Sentino</p>
      </section>
    </section>
  );
}
