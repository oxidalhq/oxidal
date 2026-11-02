import { useEffect, useState } from 'react';
import { capabilities } from './api';

const features = [
  {
    title: 'Neural amps and cabs',
    detail: 'TONE3000 A2 NAM captures and your own NAM and IR files.',
  },
  {
    title: 'Rigs with scenes',
    detail: 'Serial, parallel and scene rigs with prepared live switching.',
  },
  {
    title: 'Made to play',
    detail: 'LV2 effects, MIDI control, guitar profiles and a stage tuner.',
  },
  {
    title: 'Sound Check',
    detail: 'Loudness matching and live diagnostics for the whole unit.',
  },
];

/** Product identity and capability overview; licensing is intentionally deferred. */
export function About() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    capabilities()
      .then((health) => {
        if (active) setVersion(health.version);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="about-oxidal" aria-labelledby="about-oxidal-title">
      <div className="about-oxidal-intro">
        <span className="about-oxidal-mark" aria-hidden="true">
          ø
        </span>
        <p className="about-oxidal-kind">
          Device-local guitar and bass processor
          {version ? ` · version ${version}` : ''}
        </p>
        <h2 id="about-oxidal-title">An open instrument, not a preset player</h2>
        <p>
          Oxidal turns a Raspberry Pi 5 and your chosen audio interface into a
          flexible live processor. It combines neural captures, impulse
          responses and effects in rigs that can move from a simple amp sound to
          layered scenes and performance-ready switching.
        </p>
      </div>

      <section aria-labelledby="about-capabilities">
        <h3 id="about-capabilities">What it does</h3>
        <ul className="about-feature-grid">
          {features.map((feature) => (
            <li key={feature.title}>
              <strong>{feature.title}</strong>
              <span>{feature.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="about-difference">
        <h3 id="about-difference">What makes it different</h3>
        <p>
          Rigs are built from explicit signal paths instead of a fixed number of
          lanes. Native engines can mix Full and Lite A2 models per block, while
          scenes recall prepared branch mixes without rebuilding the sound. The
          browser is the controller; audio processing and your library remain on
          the device.
        </p>
      </section>

      <section className="about-author" aria-labelledby="about-author">
        <h3 id="about-author">Created and developed by</h3>
        <p>Richard Sentino</p>
      </section>
    </section>
  );
}
