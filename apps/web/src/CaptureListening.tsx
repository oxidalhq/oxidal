import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  BrowserListening,
  CaptureReferences,
  ListeningSelect,
} from '@oxidal/design-system/widgets/capture-listening';

import {
  captureLevels,
  type LocalModel,
  localModels,
  type MediaLibrary,
  mediaLibrary,
} from './api';
import {
  auditionAsset,
  auditionPair,
  loadAudition,
  reductions,
} from './reampComparison';

export function CaptureListening({
  appliedTrim,
  audition = false,
}: {
  appliedTrim: number | null;
  audition?: boolean;
}) {
  const [listening, setListening] = useState(false);
  return (
    <div className="grid gap-4">
      <ReferenceTool appliedTrim={appliedTrim} />
      {audition && !listening && (
        <div>
          <Button variant="outline" onClick={() => setListening(true)}>
            Open browser audition
          </Button>
        </div>
      )}
      {listening && <AuditionTool onClose={() => setListening(false)} />}
    </div>
  );
}

function ReferenceTool({ appliedTrim }: { appliedTrim: number | null }) {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    localModels(after, controller.signal, false, { format: 'nam', query: '' })
      .then((page) => {
        if (controller.signal.aborted) return;
        setModels((previous) => [...previous, ...page.data]);
        setNext(page.next ?? null);
        setStatus(page.data.length || after ? '' : 'No local NAM captures.');
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setStatus('The local capture list could not be loaded.');
      });
    return () => controller.abort();
  }, [after]);
  const choices = models.map(({ id, title, name }) => ({
    id,
    title: title || name,
  }));
  return (
    <div className="grid gap-4">
      <CaptureReferences
        appliedTrim={appliedTrim}
        pedal={<ReferenceSlot name="Pedal" choices={choices} />}
        amp={<ReferenceSlot name="Amp" choices={choices} />}
      />
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      {next && (
        <div>
          <Button
            variant="outline"
            disabled={after === next}
            onClick={() => setAfter(next)}
          >
            Load more captures
          </Button>
        </div>
      )}
    </div>
  );
}

function ReferenceSlot({
  name,
  choices,
}: {
  name: string;
  choices: { id: string; title: string }[];
}) {
  const [id, setId] = useState('');
  const [loaded, setLoaded] = useState<Awaited<
    ReturnType<typeof captureLevels>
  > | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!id) return;
    let current = true;
    captureLevels(id)
      .then((data) => {
        if (current) setLoaded(data);
      })
      .catch(() => {
        if (current) setStatus('Could not read the selected capture.');
      });
    return () => {
      current = false;
    };
  }, [id]);
  const reading = (value: number | null | undefined) =>
    value == null ? 'Unknown' : `${value.toFixed(1)} dBu`;
  return (
    <div className="grid min-w-0 gap-1">
      <ListeningSelect
        label={`${name} capture reference`}
        value={id}
        choices={choices}
        onChange={(value) => {
          setId(value);
          setLoaded(null);
          setStatus('');
        }}
      />
      <p className="text-sm">Capture input {reading(loaded?.input_dbu)}</p>
      <p className="text-sm">Capture output {reading(loaded?.output_dbu)}</p>
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
    </div>
  );
}

type Audio = Awaited<ReturnType<typeof loadAudition>>;

function AuditionTool({ onClose }: { onClose: () => void }) {
  const [assets, setAssets] = useState<MediaLibrary['assets']>([]);
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('Looking for saved reamps…');
  const [busy, setBusy] = useState(false);
  const [pair, setPair] = useState<[Audio, Audio] | null>(null);
  const loading = useRef<AbortController | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const playing = useRef<{
    source: AudioBufferSourceNode;
    gain: GainNode;
  } | null>(null);
  const playVersion = useRef(0);

  function stopAudio() {
    playVersion.current += 1;
    const current = playing.current;
    playing.current = null;
    if (current) {
      current.source.onended = null;
      current.source.stop();
      current.source.disconnect();
      current.gain.disconnect();
    }
  }

  useEffect(() => {
    let open = true;
    mediaLibrary()
      .then((library) => {
        if (!open) return;
        setAssets(library.assets);
        setStatus(
          library.assets.filter(auditionAsset).length < 2
            ? 'Two complete saved reamps up to 20 seconds each are needed.'
            : '',
        );
      })
      .catch(() => {
        if (open) {
          setMessage(
            'Could not read saved reamps. Reopen the audition to try again.',
          );
          setStatus('');
        }
      });
    return () => {
      open = false;
      loading.current?.abort();
      stopAudio();
      if (audio.current) void audio.current.close().catch(() => undefined);
      audio.current = null;
    };
  }, []);

  function reset() {
    loading.current?.abort();
    stopAudio();
    setMessage('');
    setStatus('');
    setBusy(false);
    setPair(null);
  }

  async function measure() {
    reset();
    const a = assets.find((asset) => asset.id === first);
    const b = assets.find((asset) => asset.id === second);
    if (!a || !b) return;
    const controller = new AbortController();
    loading.current = controller;
    setBusy(true);
    try {
      const frames = auditionPair(a, b, assets);
      const result: [Audio, Audio] = await Promise.all([
        loadAudition(a, frames, controller.signal),
        loadAudition(b, frames, controller.signal),
      ]);
      if (!controller.signal.aborted) {
        setPair(result);
        setStatus('Measured across the shared dry phrase.');
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error
            ? error.message
            : 'Could not measure the pair.',
        );
    } finally {
      if (!controller.signal.aborted) {
        controller.abort();
        setBusy(false);
      }
    }
  }

  const trim = pair && reductions(pair[0].rms, pair[1].rms);
  async function play(side: 0 | 1, match: boolean) {
    if (!pair || !trim) return;
    stopAudio();
    const version = playVersion.current;
    setMessage('');
    setStatus('');
    try {
      const context = audio.current ?? new AudioContext();
      audio.current = context;
      await context.resume();
      if (version !== playVersion.current) return;
      const { samples, frames, rate } = pair[side];
      const buffer = context.createBuffer(samples.length, frames, rate);
      samples.forEach((channel, index) =>
        buffer.getChannelData(index).set(channel),
      );
      const source = context.createBufferSource();
      const gain = context.createGain();
      gain.gain.value = match ? 10 ** (trim[side] / 20) : 1;
      source.buffer = buffer;
      source.connect(gain).connect(context.destination);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        if (playing.current?.source === source) {
          playing.current = null;
          setStatus('Browser playback finished.');
        }
      };
      source.start();
      playing.current = { source, gain };
      setStatus(
        `Playing ${side === 0 ? 'A' : 'B'} in this browser at ${(match ? trim[side] : 0).toFixed(1)} dB trim.`,
      );
    } catch {
      if (version === playVersion.current)
        setMessage('Could not start browser audio.');
    }
  }

  return (
    <BrowserListening
      choices={assets
        .filter(auditionAsset)
        .map(({ id, title, created_at, provenance }) => {
          const rig = provenance?.rig?.scene ?? provenance?.rig?.name;
          const caption = typeof rig === 'string' ? ` · ${rig}` : '';
          return {
            id,
            title: `${title}${caption} · ${new Date(created_at).toLocaleString()}`,
          };
        })}
      first={first}
      second={second}
      onFirst={(id) => {
        reset();
        setFirst(id);
      }}
      onSecond={(id) => {
        reset();
        setSecond(id);
      }}
      onMeasure={() => void measure()}
      measurements={
        pair &&
        trim && [
          { rms: pair[0].rms, reduction: trim[0] },
          { rms: pair[1].rms, reduction: trim[1] },
        ]
      }
      busy={busy}
      message={message}
      status={status}
      onPlay={(side, match) => void play(side, match)}
      onStop={() => {
        stopAudio();
        setStatus('Browser audio stopped.');
      }}
      onClose={onClose}
    />
  );
}
