import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { terminalCommand, type TerminalState } from './api';
import { Button } from './components/ui/button';

/** Input is never persisted or retried; reconnect only reads the existing PTY. */
function TerminalPanel({ mode }: { mode: 'unprivileged' | 'admin' }) {
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef({
    start: () => {},
    end: () => {},
    interrupt: () => {},
    reconnect: () => {},
  });
  const [state, setState] = useState<TerminalState | null>(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const command = (value: Parameters<typeof terminalCommand>[0]) =>
      terminalCommand(value, mode);
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let id: string | undefined;
    let cursor = 0;
    let sequence = 0;
    let ready = false;
    let disconnected = false;
    let startPending = false;
    let endPending = false;
    let resizePending = false;
    const input: number[][] = [];
    const terminal = new Terminal({
      cursorBlink: false,
      fontSize: 14,
      rows: 18,
      cols: 80,
      scrollback: 2000,
      screenReaderMode: true,
      theme: {
        background: '#111111',
        foreground: '#ffffff',
        cursor: '#ffffff',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    const resize = () => {
      fit.fit();
      terminal.resize(
        Math.max(10, Math.min(300, terminal.cols)),
        Math.max(2, Math.min(150, terminal.rows)),
      );
      resizePending = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    function send(text: string) {
      if (!ready || disconnected) return;
      const bytes = new TextEncoder().encode(text);
      if (bytes.length + input.reduce((n, b) => n + b.length, 0) > 65536) {
        setError('Input queue is full. This paste was not sent.');
        return;
      }
      for (let offset = 0; offset < bytes.length; offset += 8192)
        input.push(Array.from(bytes.slice(offset, offset + 8192)));
    }
    const data = terminal.onData(send);
    actions.current = {
      start: () => {
        startPending = true;
        disconnected = false;
        setError('');
      },
      end: () => {
        endPending = true;
        input.length = 0;
      },
      interrupt: () => {
        input.length = 0;
        send('\x03');
        terminal.focus();
      },
      reconnect: () => {
        input.length = 0;
        disconnected = false;
        id = undefined;
        cursor = 0;
        setError('');
      },
    };
    async function poll() {
      try {
        if (disconnected) return;
        if (startPending) {
          startPending = false;
          await command({
            type: 'start',
            id: crypto.randomUUID().replaceAll('-', ''),
            cols: terminal.cols,
            rows: terminal.rows,
          });
        }
        if (!active) return;
        if (endPending && id) {
          endPending = false;
          await command({ type: 'end', id });
          ready = false;
          setConnected(false);
        }
        if (ready && id) {
          if (resizePending) {
            resizePending = false;
            await command({
              type: 'resize',
              id,
              cols: terminal.cols,
              rows: terminal.rows,
            });
          }
          // One serialized input packet per poll. Failed/ambiguous input is never replayed.
          const bytes = input.shift();
          if (bytes) {
            await command({ type: 'input', id, sequence, bytes });
            sequence += 1;
          }
        }
        if (!active) return;
        const next = await command({ type: 'read', id: null, cursor });
        if (!active) return;
        setState(next);
        setConnected(true);
        if (!next.session) {
          ready = false;
          id = undefined;
          cursor = 0;
          return;
        }
        const session = next.session;
        ready = session.running;
        if (id !== session.id) {
          id = session.id;
          cursor = 0;
          sequence = session.next_input;
          input.length = 0;
          terminal.reset();
          resizePending = true;
          // Read this session from its own replay window; don't mix old offsets.
          return;
        }
        sequence = session.next_input;
        if (session.dropped)
          terminal.writeln(
            '\r\n[Older output is outside the replay window]\r\n',
          );
        await new Promise<void>((resolve) =>
          terminal.write(new Uint8Array(session.bytes), resolve),
        );
        cursor = session.cursor;
      } catch (e) {
        input.length = 0;
        disconnected = true;
        ready = false;
        if (active) {
          setConnected(false);
          setError(
            e instanceof Error
              ? e.message
              : 'Terminal disconnected. Reconnect to read its state; input will not be replayed.',
          );
        }
      } finally {
        if (active)
          timer = setTimeout(() => void poll(), input.length ? 0 : 150);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      observer.disconnect();
      data.dispose();
      terminal.dispose();
      input.length = 0;
    };
  }, [mode]);
  return (
    <div className="mt-3 grid min-w-0 gap-3">
      <p className="caption">
        {mode === 'admin'
          ? 'Use sudo and the admin password for system changes. '
          : 'Unprivileged shell. '}
        Session stays open until End. No command time or total-output cutoff.
      </p>
      <p role="status">
        {state
          ? `${state.identity} · ${state.directory} · ${connected ? (state.session?.running ? 'running' : 'ready') : 'disconnected'}`
          : 'Connecting to terminal service…'}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="action-row">
        <Button
          disabled={!connected || !!state?.session}
          onClick={() => actions.current.start()}
        >
          Start terminal
        </Button>
        <Button
          variant="outline"
          disabled={!connected || !state?.session?.running}
          onClick={() => actions.current.interrupt()}
        >
          Ctrl-C
        </Button>
        <Button
          variant="outline"
          disabled={!connected || !state?.session}
          onClick={() => actions.current.end()}
        >
          End session
        </Button>
        <Button variant="outline" onClick={() => actions.current.reconnect()}>
          Reconnect terminal
        </Button>
      </div>
      <div
        ref={host}
        aria-label="Interactive terminal"
        className="h-80 min-w-0 overflow-hidden rounded-md border border-border bg-[#111] p-2"
      />
    </div>
  );
}
export function WebTerminal() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'unprivileged' | 'admin'>('unprivileged');
  return (
    <section className="panel min-w-0" aria-label="Web terminal">
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Interactive terminal</summary>
        {open && (
          <>
            <label className="field mt-3">
              Terminal access
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="unprivileged">Unprivileged</option>
                <option value="admin">Administrator · password sudo</option>
              </select>
            </label>
            <p className="caption">
              Changing access leaves the other session running. End each session
              when finished.
            </p>
            <TerminalPanel key={mode} mode={mode} />
          </>
        )}
      </details>
    </section>
  );
}
