import { useState } from 'react';

import { Button } from '../components/ui/button';
import {
  BrowserListening,
  CaptureReferences,
  ListeningSelect,
} from './capture-listening';

const captures = [
  { id: 'pedal', title: 'Drive pedal' },
  { id: 'amp', title: 'Clean amp' },
];
const renders = [
  { id: 'clean', title: 'Short phrase · Clean' },
  { id: 'lead', title: 'Short phrase · Lead' },
];

export function CaptureReferencesDemo({
  appliedTrim = -6,
}: {
  appliedTrim?: number;
}) {
  const [pedal, setPedal] = useState('pedal');
  const [amp, setAmp] = useState('amp');
  return (
    <CaptureReferences
      appliedTrim={appliedTrim}
      pedal={
        <div>
          <ListeningSelect
            label="Pedal capture reference"
            choices={captures}
            value={pedal}
            onChange={setPedal}
          />
          <p className="text-sm">
            Capture input {pedal ? '−12.0 dBu' : 'Unknown'}
          </p>
          <p className="text-sm">Capture output Unknown</p>
        </div>
      }
      amp={
        <div>
          <ListeningSelect
            label="Amp capture reference"
            choices={captures}
            value={amp}
            onChange={setAmp}
          />
          <p className="text-sm">
            Capture input {amp ? '−6.0 dBu' : 'Unknown'}
          </p>
          <p className="text-sm">Capture output Unknown</p>
        </div>
      }
    />
  );
}

export function BrowserListeningDemo() {
  const [open, setOpen] = useState(false);
  return open ? (
    <ListeningDemo onClose={() => setOpen(false)} />
  ) : (
    <div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open browser audition
      </Button>
    </div>
  );
}

function ListeningDemo({ onClose }: { onClose: () => void }) {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [measured, setMeasured] = useState(false);
  const [status, setStatus] = useState('');
  return (
    <BrowserListening
      choices={renders}
      first={first}
      second={second}
      onFirst={(id) => {
        setFirst(id);
        setMeasured(false);
        setStatus('');
      }}
      onSecond={(id) => {
        setSecond(id);
        setMeasured(false);
        setStatus('');
      }}
      onMeasure={() => {
        setMeasured(true);
        setStatus('Measured across the shared dry phrase.');
      }}
      measurements={
        measured
          ? first === 'clean'
            ? [
                { rms: -24, reduction: 0 },
                { rms: -18, reduction: -6 },
              ]
            : [
                { rms: -18, reduction: -6 },
                { rms: -24, reduction: 0 },
              ]
          : null
      }
      onPlay={(side) =>
        setStatus(`Example playback ${side === 0 ? 'A' : 'B'}.`)
      }
      onStop={() => setStatus('Browser audio stopped.')}
      status={status}
      onClose={onClose}
    />
  );
}
