import {
  Copy,
  DownloadSimple,
  Pause,
  TerminalWindow,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  ActionRow,
  FormField,
} from '@oxidal/design-system/components/form-layout';
import { Caption } from '@oxidal/design-system/components/text';
import { SettingDisclosure } from '@oxidal/design-system/patterns/settings-page';

import { type DebugCommand, debugCommand, type DebugState } from './api';
import { friendlyError } from './lib/friendlyError';
/** Commands are intentionally sent only to the isolated, unprivileged debug executor. */
export function DebugConsole() {
  const [state, setState] = useState<DebugState | null>(null);
  const [command, setCommand] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [logText, setLogText] = useState('');
  const [logMessage, setLogMessage] = useState('');
  const [copying, setCopying] = useState(false);
  const [following, setFollowing] = useState(false);
  useEffect(() => {
    if (!open || !following) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function read() {
      try {
        if (document.hidden) return;
        const response = await fetch('/api/v1/debug/logs', {
          cache: 'no-store',
          signal: abort.signal,
        });
        if (!response.ok) throw new Error('Logs temporarily unavailable');
        const text = await response.text();
        if (active) {
          setLogText(text);
          setLogMessage('Following native logs · 5s refresh');
        }
      } catch {
        if (active) setLogMessage('Log connection interrupted; retrying.');
      } finally {
        if (active) timer = setTimeout(() => void read(), 5000);
      }
    }
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
      abort.abort();
    };
  }, [open, following]);
  async function copyLogs() {
    setCopying(true);
    setLogMessage('');
    setLogText('');
    try {
      const response = await fetch('/api/v1/debug/logs', { cache: 'no-store' });
      if (!response.ok) throw new Error('Logs are temporarily unavailable.');
      const text = await response.text();
      try {
        await navigator.clipboard.writeText(text);
        setLogMessage('Logs copied.');
      } catch {
        setLogText(text);
        setLogMessage('Select the text below, or download the logs.');
      }
    } catch (cause) {
      setLogMessage(friendlyError(cause, 'read the debug log'));
    } finally {
      setCopying(false);
    }
  }
  useEffect(() => {
    if (!open) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await debugCommand();
        if (active) setState(next);
      } catch {
        if (active)
          setError('Debug service is reconnecting; commands are not retried.');
      } finally {
        if (active) timer = setTimeout(() => void poll(), 500);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open]);
  async function run(value: DebugCommand) {
    setBusy(true);
    setError('');
    try {
      setState(await debugCommand(value));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Debug request failed');
    } finally {
      setBusy(false);
    }
  }
  const running = state?.job?.phase === 'running';
  return (
    <section aria-label="Debug console" className="grid min-w-0">
      <SettingDisclosure
        label="Debug console"
        caption="Copy or follow logs, and run a fixed set of diagnostics for 15 minutes at a time."
        open={open}
        onOpenChange={setOpen}
      >
        <ActionRow className="my-3">
          <Button
            variant="outline"
            disabled={copying}
            onClick={() => void copyLogs()}
          >
            <Copy aria-hidden="true" />
            {copying ? 'Collecting logs…' : 'Copy logs'}
          </Button>
          <Button
            variant="outline"
            aria-pressed={following}
            onClick={() => setFollowing((v) => !v)}
          >
            {following ? (
              <Pause aria-hidden="true" />
            ) : (
              <TerminalWindow aria-hidden="true" />
            )}
            {following ? 'Freeze logs' : 'Follow logs'}
          </Button>
          <Button variant="outline" asChild>
            <a href="/api/v1/debug/logs" download="oxidal-logs.txt">
              <DownloadSimple className="mr-2 size-4" aria-hidden="true" />
              Download logs
            </a>
          </Button>
        </ActionRow>
        {logMessage && <p role="status">{logMessage}</p>}
        {logText && (
          <textarea
            aria-label="Collected native logs"
            readOnly
            spellCheck={false}
            value={logText}
            rows={8}
            className="mt-2 w-full font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
        )}

        <Caption className="mt-3">
          Commands run as a separate unprivileged user, for up to 30 seconds
          with 8 KiB of combined output. This is a command runner, not an
          interactive terminal. No command history is saved. Closing this page
          does not cancel an accepted command.
        </Caption>
        <p role="status" className="my-3 text-sm">
          {state?.available
            ? `${state.identity} · ${state.directory} · ${state.enabled ? `enabled ${state.remaining_seconds}s` : 'disabled'}`
            : state?.message || 'Reading debug availability…'}
        </p>
        {error && (
          <p
            role="alert"
            className="mb-4 min-w-0 rounded-lg border border-destructive px-3 py-2.5 wrap-anywhere text-destructive"
          >
            {error}
          </p>
        )}
        {state?.available && (
          <>
            <ActionRow>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run({ type: state.enabled ? 'disable' : 'enable' })
                }
              >
                {state.enabled
                  ? 'Disable debug mode'
                  : 'Enable debug mode for 15 minutes'}
              </Button>
              {running && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run({ type: 'cancel', id: state.job!.id })
                  }
                >
                  Cancel command
                </Button>
              )}
            </ActionRow>
            <ActionRow
              className="my-3"
              role="group"
              aria-label="Diagnostic command suggestions"
            >
              {[
                { name: 'System', command: 'uname -a; uptime' },
                { name: 'Audio devices', command: 'cat /proc/asound/cards' },
                { name: 'Network links', command: 'nmcli device status' },
                {
                  name: 'Services',
                  command: 'systemctl --no-pager status oxidald oxidal-device',
                },
              ].map((s) => (
                <Button
                  key={s.name}
                  variant="outline"
                  disabled={!state.enabled || busy || running}
                  onClick={() => setCommand(s.command)}
                >
                  {s.name}
                </Button>
              ))}
            </ActionRow>
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const text = command;
                setCommand('');
                void run({ type: 'run', command: text });
              }}
            >
              <FormField>
                Command
                <textarea
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  maxLength={2048}
                  required
                  rows={3}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={!state.enabled || busy || running}
                  className="w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
                />
              </FormField>
              <Button
                type="submit"
                disabled={!state.enabled || busy || running || !command.trim()}
              >
                Run command
              </Button>
            </form>
            {state.job && (
              <div className="mt-3 grid gap-2">
                <p className="font-mono text-xs">
                  {state.job.phase.replaceAll('_', ' ')} ·{' '}
                  {state.job.elapsed_ms} ms
                  {state.job.exit_code != null
                    ? ` · exit ${state.job.exit_code}`
                    : ''}
                </p>
                <pre
                  aria-label="Command output"
                  className="max-h-80 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs break-words whitespace-pre-wrap"
                >
                  {state.job.output ||
                    (running ? 'Waiting for output…' : 'No output')}
                </pre>
              </div>
            )}
          </>
        )}
      </SettingDisclosure>
    </section>
  );
}
