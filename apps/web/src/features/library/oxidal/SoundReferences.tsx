import { Caption } from '@oxidal/design-system/components/text';

/** Listening comparisons describe musical use, not an exact recorded rig.
 * @see docs/factory-collection.md
 */
const references: Record<string, [string, string, string]> = {
  'E80-01': [
    'Van Halen',
    'Panama',
    'Crunchy rhythm, muted attack and the lift into a lead.',
  ],
  'E80-02': [
    'Rush',
    'Limelight',
    'Wide chorus texture with a clear rhythm attack.',
  ],
  'E80-03': [
    'AC/DC',
    'Back in Black',
    'Space between dry power chords and pick dynamics.',
  ],
  'E80-04': [
    'Metallica',
    'Master of Puppets',
    'Tight palm-muted rhythm and low-end definition.',
  ],
  'E80-05': [
    'The Police',
    'Every Breath You Take',
    'Clean arpeggio clarity and restrained modulation.',
  ],
  'E80-06': [
    'The Cure',
    'Pictures of You',
    'Bright clean layers with width and sustained notes.',
  ],
  'E90-01': [
    'Nirvana',
    'Smells Like Teen Spirit',
    'The contrast between a restrained verse and distorted chorus.',
  ],
  'E90-02': [
    'Pantera',
    'Walk',
    'Low, percussive rhythm and stops between phrases.',
  ],
  'E90-04': [
    'Oasis',
    'Live Forever',
    'Open chord shimmer and a melodic lead above it.',
  ],
  'E00-03': [
    'The White Stripes',
    'Seven Nation Army',
    'A strong fuzz-led riff rather than a polished high-gain wall.',
  ],
  'EMD-01': [
    'Meshuggah',
    'Bleed',
    'Low-string attack and tightly stopped rhythmic figures.',
  ],
  'EMD-05': [
    'Black Sabbath',
    'Sweet Leaf',
    'Slow, heavy riff weight and sustained distortion.',
  ],
  'EMD-06': [
    'Dick Dale',
    'Misirlou',
    'Fast picking with a bright spring-like splash.',
  ],
  'OX-03': [
    'Dick Dale',
    'Misirlou',
    'The reverb splash around a sharp picked note.',
  ],
  'OX-14': [
    'U2',
    'Where the Streets Have No Name',
    'Dotted echoes interlocking with evenly picked notes; set the tempo first.',
  ],
  'OX-16': [
    'Pink Floyd',
    'Run Like Hell',
    'Rhythmic repeats that fill the spaces between attacks.',
  ],
  'OX-20': [
    'Jimi Hendrix',
    'Little Wing',
    'Rotating-speaker movement around clean chord fragments.',
  ],
  'OX-21': [
    'Jimi Hendrix',
    'Machine Gun',
    'Slow, deep modulation under sustained notes.',
  ],
  'OX-23': [
    'Van Halen',
    'Unchained',
    'A sweeping flange around a strongly picked riff.',
  ],
  'OX-24': [
    'Nirvana',
    'Come As You Are',
    'A clean chorus texture with an audible, even wobble.',
  ],
};

/** A concrete listening target, or the recipe's own musical description.
 * @see docs/factory-collection.md
 */
export function SoundReferences({
  id,
  description,
}: {
  id?: string;
  description: string;
}) {
  const example = id ? references[id] : undefined;
  return (
    <section aria-label="Listening guide" className="min-w-0 space-y-2">
      <h3>Listening guide</h3>
      <table className="w-full table-fixed text-left text-sm [&_td]:py-2 [&_td]:pr-3 [&_td]:align-top [&_th]:py-2 [&_tr]:border-b [&_tr]:border-border">
        <thead>
          <tr>
            <th>Artist / song</th>
            <th>What to listen for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              {example ? (
                <>
                  {example[0]}
                  <br />
                  {example[1]}
                </>
              ) : (
                'Original Oxidal sound'
              )}
            </td>
            <td>{example?.[2] ?? description}</td>
          </tr>
        </tbody>
      </table>
      {example && (
        <Caption>
          A listening reference for style and technique, not a claim to recreate
          the recording or its equipment.
        </Caption>
      )}
    </section>
  );
}
