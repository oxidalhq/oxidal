import { Button } from '@oxidal/design-system/components/button';
import { ActionRow } from '@oxidal/design-system/components/form-layout';

import type { AudioAction } from './api';
type Command = Extract<AudioAction, { kind: 'host_utility' }>['command'];
/** Shared device controls; never saved as effect/preset controls. */
export function HostAudioControls({
  hear,
  disabled,
  error,
  send,
}: {
  hear: boolean;
  disabled: boolean;
  error: string;
  send: (command: Command) => Promise<void>;
}) {
  return (
    <section
      className="grid min-w-0 items-start gap-3 [&>button]:max-w-full [&>button]:justify-self-start"
      aria-label="Audio monitoring and output test"
    >
      <ActionRow>
        <Button
          variant="outline"
          disabled={disabled}
          aria-pressed={hear}
          onClick={() => void send({ kind: 'hear_yourself', enabled: !hear })}
        >
          {hear ? 'Monitor input' : 'Input monitoring off'}
        </Button>
        <Button
          variant="outline"
          disabled={disabled}
          title="440 Hz, half a second, −30 dBFS, after the effects"
          onClick={() => void send({ kind: 'test_tone' })}
        >
          Output test · quiet
        </Button>
      </ActionRow>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
