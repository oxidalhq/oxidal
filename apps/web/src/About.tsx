import { Badge } from './components/ui/badge';

const features = [
  'TONE3000 A2 NAM and local NAM/IR libraries',
  'Serial, parallel and scene-based rigs with prepared live switching',
  'LV2 effects, MIDI control, guitar profiles and a stage tuner',
  'Sound Check, loudness matching and live device diagnostics',
];

/** Product identity and capability overview; licensing is intentionally deferred. */
export function About() {
  return (
    <section className="about-oxidal" aria-labelledby="about-oxidal-title">
      <div className="about-oxidal-intro">
        <Badge>Device-local guitar and bass processor</Badge>
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
        <ul className="about-feature-list">
          {features.map((feature) => (
            <li key={feature}>{feature}</li>
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
