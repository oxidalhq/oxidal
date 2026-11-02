import { useEffect, useState } from 'react';
import { DownloadSimple, WarningCircle } from '@phosphor-icons/react';
import { downloadVoice, tone3000Tone, toneImage, type TonePage } from './api';
import { Button } from './components/ui/button';
import { StateNotice } from './components/ui/state-notice';
import {
  factoryVoices,
  primaryCapture,
  type FactoryVoiceId,
} from './factoryVoices';
import type { RigNativeSource } from './generated/contract';

type Tone = TonePage['data'][number];

/**
 * One amp slot of a factory preset. When its capture is not on the device the
 * player sees what it is, as TONE3000 presents it, and one Download button; the
 * download happens only on that tap, one preset's captures at a time.
 * @see docs/factory-collection.md
 */
export function VoiceSlot({
  voice,
  disabled,
  onReady,
}: {
  voice: FactoryVoiceId;
  disabled: boolean;
  onReady: (source: RigNativeSource) => void;
}) {
  const capture = primaryCapture(voice);
  const [tone, setTone] = useState<Tone | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    tone3000Tone(capture.tone, controller.signal)
      .then(setTone)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(String(cause));
      });
    return () => controller.abort();
  }, [capture.tone]);
  async function download() {
    if (!tone) return;
    setBusy(true);
    setError('');
    try {
      const ready = await downloadVoice(
        capture.tone,
        capture.model,
        tone.title.slice(0, 120),
      );
      onReady(ready.capture.source);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="voice-slot" data-state={busy ? 'downloading' : 'needed'}>
      <div className="voice-slot-head">
        <img src={toneImage(capture.tone)} alt="" width={56} height={56} />
        <div>
          <strong>{factoryVoices[voice].character}</strong>
          {tone ? (
            <span className="caption">
              TONE3000 · {tone.title} ·{' '}
              {tone.user.display_name || tone.user.username} · licence{' '}
              {tone.license}
            </span>
          ) : (
            <span className="caption">Reading the capture from TONE3000…</span>
          )}
        </div>
      </div>
      {error && (
        <StateNotice kind="error" title="Download unavailable">
          {error}
        </StateNotice>
      )}
      <Button
        variant="outline"
        disabled={disabled || busy || !tone}
        onClick={() => void download()}
      >
        {error ? (
          <WarningCircle aria-hidden="true" />
        ) : (
          <DownloadSimple aria-hidden="true" />
        )}
        {busy ? 'Downloading…' : error ? 'Try again' : 'Download'}
      </Button>
    </div>
  );
}
