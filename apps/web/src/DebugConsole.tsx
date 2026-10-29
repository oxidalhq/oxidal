import { useEffect, useState } from 'react';
import { debugCommand, type DebugState, type DebugCommand } from './api';
import { Button } from './components/ui/button';
/** Commands are intentionally sent only to the isolated, unprivileged debug executor. */
export function DebugConsole() {
  const [state, setState] = useState<DebugState | null>(null);
  const [command, setCommand] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [logText, setLogText] = useState('');
  const [logMessage, setLogMessage] = useState('');
  const [copying, setCopying] = useState(false);
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
      setLogMessage(String(cause));
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
    <section className="panel" aria-label="Debug console">
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Debug console</summary>
        <div className="action-row my-3">
          <Button
            variant="outline"
            disabled={copying}
            onClick={() => void copyLogs()}
          >
            {copying ? 'Collecting logs…' : 'Copy logs'}
          </Button>
          <a
            className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm"
            href="/api/v1/debug/logs"
            download="oxidal-logs.txt"
          >
            Download logs
          </a>
        </div>
        {logMessage && <p role="status">{logMessage}</p>}
        {logText && (
          <textarea
            aria-label="Collected native logs"
            readOnly
            value={logText}
            rows={8}
            className="mt-2 w-full font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
        )}

        <p className="caption mt-3">
          Commands run as a separate unprivileged user, for up to 30 seconds
          with 8 KiB of combined output. This is a command runner, not an
          interactive terminal. No command history is saved. Closing this page
          does not cancel an accepted command.
        </p>
        <p role="status" className="my-3 text-sm">
          {state?.available
            ? `${state.identity} · ${state.directory} · ${state.enabled ? `enabled ${state.remaining_seconds}s` : 'disabled'}`
            : state?.message || 'Reading debug availability…'}
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {state?.available && (
          <>
            <div className="action-row">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run({ type: state.enabled ? 'disable' : 'enable' })
                }
              >
                {state.enabled
                  ? 'Disable debug mode'
                  : 'Enable debug mode for 5 minutes'}
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
            </div>
            <div
              className="action-row my-3"
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
            </div>
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const text = command;
                setCommand('');
                void run({ type: 'run', command: text });
              }}
            >
              <label className="field">
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
              </label>
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
      </details>
    </section>
  );
}
