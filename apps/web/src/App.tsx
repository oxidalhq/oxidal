import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowsSplit,
  CheckCircle,
  GearSix,
  Power,
  WarningCircle,
} from '@phosphor-icons/react';
import { Button } from './components/ui/button';
import { Library } from './Library';
import { AudioSettings } from './AudioSettings';
import { ControlEditor } from './ControlEditor';
import {
  capabilities,
  parseSnapshot,
  sendCommand,
  type Action,
  type MappingFile,
  type Snapshot,
} from './api';

/** Quiet rig control over a single authoritative Rust state model.
 * @see docs/architecture.md
 */
export default function App() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [simulator, setSimulator] = useState(false);
  const [view, setView] = useState<'rig' | 'settings' | 'library'>('rig');
  const [displayMode, setDisplayMode] = useState(() => {
    try {
      const saved = localStorage.getItem('oxidal.display');
      return saved && ['orchid', 'sunlight', 'stage', 'epaper'].includes(saved)
        ? saved
        : 'orchid';
    } catch {
      return 'orchid';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.display = displayMode;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        'content',
        displayMode === 'stage'
          ? '#151219'
          : displayMode === 'orchid'
            ? '#241b2b'
            : '#ffffff',
      );
    try {
      localStorage.setItem('oxidal.display', displayMode);
    } catch {
      /* The selection still works when browser storage is unavailable. */
    }
  }, [displayMode]);
  const [focusedBlock, setFocusedBlock] = useState('nam-a');
  const [error, setError] = useState('');
  const [validation, setValidation] = useState('');
  const [draft, setDraft] = useState('');
  const [midiValue, setMidiValue] = useState(64);
  const [cc, setCc] = useState(21);
  const [channel, setChannel] = useState(1);
  const [target, setTarget] = useState('nam-a.level');
  const [mode, setMode] = useState<'absolute' | 'relative_twos_complement'>(
    'absolute',
  );
  const [minimum, setMinimum] = useState(0);
  const [maximum, setMaximum] = useState(1);
  const [curve, setCurve] = useState<'linear' | 'logarithmic'>('linear');
  const [learning, setLearning] = useState(false);
  const learnArmed = useRef(false);
  const [pickup, setPickup] = useState(false);
  const [feedback, setFeedback] = useState(true);
  const accept = useCallback((next: Snapshot, expectedSession?: string) => {
    setState((previous) => {
      if (previous && expectedSession && previous.session !== expectedSession)
        return previous;
      return !previous ||
        previous.session !== next.session ||
        next.revision >= previous.revision
        ? next
        : previous;
    });
    if (learnArmed.current && next.origin === 'midi' && next.last_midi) {
      setCc(next.last_midi.cc);
      setChannel(next.last_midi.channel);
      learnArmed.current = false;
      setLearning(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let events: EventSource | null = null;
    const open = () => {
      events?.close();
      const source = new EventSource('/api/v1/events');
      events = source;
      source.addEventListener('state', (event: MessageEvent<string>) => {
        try {
          const next = parseSnapshot(JSON.parse(event.data));
          if (active && events === source) {
            accept(next);
            setConnected(true);
          }
        } catch {
          if (active) {
            setError('Device sent incompatible state');
            setConnected(false);
          }
        }
      });
      events.onerror = () => {
        if (active) setConnected(false);
      };
      void capabilities()
        .then((info) => {
          if (active) setSimulator(info.midi_transport === 'simulator');
        })
        .catch((e: unknown) => {
          if (active) setError(String(e));
        });
    };
    const offline = () => {
      events?.close();
      if (active) setConnected(false);
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', open);
    open();
    return () => {
      active = false;
      events?.close();
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', open);
    };
  }, [accept]);

  function showSettings() {
    const mapping = state?.mappings.mappings[0];
    if (mapping) {
      setCc(mapping.cc);
      setChannel(mapping.channel);
      setTarget(mapping.target);
      setMode(mapping.mode);
      setMinimum(mapping.min);
      setMaximum(mapping.max);
      setCurve(mapping.curve);
      setPickup(mapping.pickup);
      setFeedback(mapping.feedback);
    }
    setView('settings');
  }

  async function run(action: Action, structural = false) {
    setError('');
    try {
      const next = await sendCommand(
        action,
        structural ? (state?.revision ?? null) : null,
        state?.session ?? '',
      );
      accept(next, state?.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update device');
    }
  }
  async function routing(parallel: boolean) {
    if (!state) return;
    const rig = structuredClone(state.rig);
    rig.nodes = rig.nodes.filter((node) => node.id !== 'nam-b');
    rig.edges = rig.edges.filter(
      (edge) => edge.from !== 'nam-b' && edge.to !== 'nam-b',
    );
    if (parallel) {
      rig.nodes.splice(2, 0, { id: 'nam-b', kind: 'nam', level: 0.5 });
      rig.edges.push(
        { from: 'input', to: 'nam-b' },
        { from: 'nam-b', to: 'delay' },
      );
    }
    await run({ type: 'routing', rig }, true);
  }
  async function validateDraft() {
    try {
      const rig: unknown = JSON.parse(draft || JSON.stringify(state?.rig));
      const response = await fetch('/api/v1/rig/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rig),
      });
      const result: unknown = await response.json();
      if (
        !response.ok ||
        !result ||
        typeof result !== 'object' ||
        !('valid' in result) ||
        !('errors' in result) ||
        !Array.isArray(result.errors)
      )
        throw new Error('Invalid rig payload');
      setValidation(result.valid ? 'Rig is valid' : result.errors.join(' · '));
    } catch {
      setValidation('Invalid JSON or rig payload');
    }
  }
  function saveMapping() {
    const file: MappingFile = {
      version: 1,
      mappings: [
        {
          id: 'knob-1',
          device: 'simulator',
          channel,
          cc,
          target,
          mode,
          pickup,
          feedback,
          min: minimum,
          max: maximum,
          curve,
        },
      ],
    };
    void run({ type: 'mappings', file }, true);
  }
  const parallel = state?.rig.nodes.some((node) => node.id === 'nam-b');
  const named = (id: string) => state?.rig.nodes.find((node) => node.id === id);
  const selectedBlock = named(focusedBlock) ? focusedBlock : 'nam-a';
  const blockNames: Record<string, string> = {
    'nam-a': 'NAM A',
    'nam-b': 'NAM B',
    delay: 'Delay',
    reverb: 'Reverb',
    output: 'Output',
  };
  const block = (id: string, name: string, detail: string) => {
    const parameter = state?.parameters.find((p) => p.id.startsWith(`${id}.`));
    const content = (
      <>
        <span className="block-meta">
          <span className="eyebrow">{named(id)?.kind ?? 'block'}</span>
          {parameter && (
            <span className="block-value">
              {Math.round(parameter.value * 100)}%
            </span>
          )}
        </span>
        <strong>{name}</strong>
        <span>{detail}</span>
      </>
    );
    return parameter ? (
      <button
        type="button"
        className="block"
        data-testid={`block-${id}`}
        aria-label={`Focus ${name} controls`}
        aria-pressed={selectedBlock === id}
        onClick={() => {
          setFocusedBlock(id);
          document
            .getElementById(`control-${parameter.id}`)
            ?.scrollIntoView({ block: 'nearest' });
        }}
      >
        {content}
      </button>
    ) : (
      <div
        className={`block${id === 'input' || id === 'output' ? ' endpoint' : ''}`}
        data-testid={`block-${id}`}
      >
        {content}
      </div>
    );
  };

  return (
    <div className="app-shell" data-view={view}>
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="Oxidal home">
          <span className="brand-mark">ø</span> oxidal
        </a>
        <div className="connection" role="status">
          <span className={connected ? 'dot online' : 'dot'} />
          {connected ? 'Device connected' : 'Reconnecting…'}
        </div>
        <label className="field display-mode">
          <span className="sr-only">Display mode</span>
          <select
            value={displayMode}
            onChange={(event) => setDisplayMode(event.target.value)}
          >
            <option value="orchid">Orchid</option>
            <option value="sunlight">Sunlight</option>
            <option value="stage">Dark stage</option>
            <option value="epaper">E-paper</option>
          </select>
        </label>
        <nav aria-label="Instrument navigation">
          <Button variant="outline" onClick={() => setView('library')}>
            Library
          </Button>
          <Button
            variant="outline"
            onClick={() => (view === 'rig' ? showSettings() : setView('rig'))}
          >
            <GearSix size={18} aria-hidden="true" />
            {view === 'rig' ? 'Settings' : 'Back to rig'}
          </Button>
        </nav>
      </header>
      <div className="workspace">
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {view === 'rig'
                  ? 'Control preview'
                  : view === 'library'
                    ? 'Library'
                    : 'Settings'}
              </span>
              <h1 data-testid="active-preset">
                {view === 'rig'
                  ? !state
                    ? 'Connecting'
                    : state.preset === 'custom'
                      ? 'Custom routing'
                      : state.preset === 'parallel'
                        ? 'Parallel rig'
                        : 'Serial rig'
                  : view === 'library'
                    ? 'Preset library'
                    : 'Controls & MIDI'}
              </h1>
            </div>
            {state && view === 'rig' && (
              <div className="performance-actions preset-controls">
                <label className="field">
                  Example preset
                  <select
                    aria-label="Example preset"
                    disabled={!connected}
                    value={state.preset}
                    onChange={(e) =>
                      void run(
                        {
                          type: 'set',
                          target: 'rig.preset',
                          value: e.target.value === 'parallel' ? 1 : 0,
                        },
                        true,
                      )
                    }
                  >
                    <option value="custom" disabled>
                      Custom routing
                    </option>
                    <option value="serial">Serial</option>
                    <option value="parallel">Parallel</option>
                  </select>
                </label>
                <Button
                  className="bypass-switch"
                  variant={state.bypassed ? 'default' : 'outline'}
                  disabled={!connected}
                  aria-pressed={state.bypassed}
                  onClick={() =>
                    void run({
                      type: 'set',
                      target: 'rig.bypass',
                      value: state.bypassed ? 0 : 1,
                    })
                  }
                >
                  <Power size={20} aria-hidden="true" />
                  {state.bypassed ? 'Bypass on' : 'Bypass off'}
                </Button>
              </div>
            )}
          </div>
          {view === 'rig' && (
            <div className="notice rig-status">
              <WarningCircle size={18} aria-hidden="true" />
              <span>
                <strong>Rig preview is silent.</strong>
              </span>
              <Button variant="outline" onClick={showSettings}>
                Audio setup
              </Button>
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {!state ? (
            <p className="empty">Waiting for the local Rust service…</p>
          ) : view === 'library' ? (
            <Library connected={connected} />
          ) : view === 'rig' ? (
            <>
              <section className="panel chain-panel" aria-label="Signal chain">
                <div className="section-heading">
                  <div>
                    <h2>Signal chain</h2>
                  </div>
                  <div className="segmented" aria-label="Routing mode">
                    <Button
                      variant={!parallel ? 'default' : 'outline'}
                      aria-pressed={!parallel}
                      disabled={!connected}
                      onClick={() => void routing(false)}
                    >
                      Serial
                    </Button>
                    <Button
                      variant={parallel ? 'default' : 'outline'}
                      aria-pressed={parallel}
                      disabled={!connected}
                      onClick={() => void routing(true)}
                    >
                      <ArrowsSplit size={17} />
                      Parallel
                    </Button>
                  </div>
                </div>
                <div className="signal-path">
                  {block('input', 'Input', 'Instrument')}
                  {parallel ? (
                    <div className="route-junction" aria-label="Split input">
                      <span>SPLIT</span>
                      <ArrowRight aria-hidden="true" />
                    </div>
                  ) : (
                    <ArrowRight className="route-arrow" aria-hidden="true" />
                  )}
                  <div className="branches">
                    <div className="branch">
                      <span className="path-label">PATH A</span>
                      {block('nam-a', 'NAM A', 'Level')}
                    </div>
                    {parallel && (
                      <div className="branch">
                        <span className="path-label">PATH B</span>
                        {block('nam-b', 'NAM B', 'Level')}
                      </div>
                    )}
                  </div>
                  {parallel ? (
                    <div className="route-junction" aria-label="Merge A and B">
                      <span>MERGE</span>
                      <strong>A + B</strong>
                      <ArrowRight aria-hidden="true" />
                    </div>
                  ) : (
                    <ArrowRight className="route-arrow" aria-hidden="true" />
                  )}
                  <div className="wet-path">
                    {block('delay', 'Delay', 'Mix')}
                    <ArrowRight className="wet-arrow" aria-hidden="true" />
                    {block('reverb', 'Reverb', 'Mix')}
                  </div>
                  <ArrowRight className="route-arrow" />
                  {block('output', 'Output', 'Level')}
                </div>
                <details className="routing-details">
                  <summary>Routing details</summary>
                  <p className="caption">
                    {parallel
                      ? 'Input splits into A and B, then merges before the shared delay and reverb.'
                      : 'One NAM path feeds the shared delay and reverb.'}{' '}
                    Routing validation is active; this preview does not process
                    audio.
                  </p>
                </details>
              </section>
              <section
                className="panel controls-panel"
                aria-label="Rig controls"
              >
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">Quick controls</span>
                    <h2>
                      {blockNames[selectedBlock]}{' '}
                      <span className="muted">/ selected</span>
                    </h2>
                  </div>
                  <span className="muted">
                    Last source:{' '}
                    <strong data-testid="last-origin">{state.origin}</strong>
                  </span>
                </div>
                <div className="parameters">
                  {state.parameters.map((parameter) => (
                    <div
                      className="parameter"
                      key={parameter.id}
                      id={`control-${parameter.id}`}
                      data-selected={parameter.id.startsWith(
                        `${selectedBlock}.`,
                      )}
                      onFocusCapture={() =>
                        setFocusedBlock(parameter.id.split('.')[0] ?? 'nam-a')
                      }
                    >
                      <span>
                        {parameter.label}
                        <output data-testid={`value-${parameter.id}`}>
                          {Math.round(parameter.value * 100)}%
                        </output>
                      </span>
                      <input
                        type="range"
                        aria-label={parameter.label}
                        min={parameter.min}
                        max={parameter.max}
                        step={parameter.step}
                        value={parameter.value}
                        disabled={
                          !connected || state.edit?.target === parameter.id
                        }
                        onChange={(event) =>
                          void run({
                            type: 'set',
                            target: parameter.id,
                            value: Number(event.target.value),
                          })
                        }
                      />
                      <ControlEditor
                        parameter={parameter}
                        state={state}
                        connected={connected}
                        accept={accept}
                      />
                    </div>
                  ))}
                </div>
              </section>
              <details className="panel">
                <summary>Rig validation inspector</summary>
                <label className="field">
                  Rig JSON
                  <textarea
                    aria-label="Rig JSON"
                    rows={8}
                    value={draft || JSON.stringify(state.rig, null, 2)}
                    onChange={(event) => setDraft(event.target.value)}
                    spellCheck={false}
                  />
                </label>
                <Button
                  variant="outline"
                  onClick={() => void validateDraft()}
                  disabled={!connected}
                >
                  Validate rig
                </Button>
                <p role="status">{validation}</p>
              </details>
            </>
          ) : (
            <>
              <section className="panel" aria-label="Display preferences">
                <h2>Display</h2>
                <p>
                  Use Display mode in the header to switch between Orchid,
                  Sunlight, Dark stage and E-paper. Your choice is saved on this
                  browser.
                </p>
                <p className="muted">
                  Sunlight strengthens contrast; Dark stage reduces bright
                  surfaces. E-paper uses plain monochrome surfaces without
                  transitions. Screen brightness and e-paper refresh remain
                  device settings.
                </p>
              </section>
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>Device status</h2>
                  </div>
                  <CheckCircle size={24} />
                </div>
                <dl className="device-info">
                  <div>
                    <dt>Control service</dt>
                    <dd>Native Rust · protocol {state.protocol}</dd>
                  </div>
                  <div>
                    <dt>Audio engine</dt>
                    <dd>Unavailable in this PoC</dd>
                  </div>
                  <div>
                    <dt>MIDI transport</dt>
                    <dd>
                      {simulator
                        ? 'Simulator · physical controller pending'
                        : 'Disabled'}
                    </dd>
                  </div>
                  <div>
                    <dt>Persistence</dt>
                    <dd>MIDI mappings only; rig controls reset on restart</dd>
                  </div>
                </dl>
              </section>
              <AudioSettings connected={connected} />
              <section className="panel">
                <h2>MIDI mapping</h2>
                <p className="muted">
                  Current mapping:{' '}
                  {state.mappings.mappings
                    .map((mapping) => `CC ${mapping.cc} → ${mapping.target}`)
                    .join(', ') || 'none'}
                  . This form replaces the PoC knob mapping.
                </p>
                <div className="form-grid">
                  <label className="field">
                    Target
                    <select
                      aria-label="Target"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      {state.parameters.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                      {state.actions.map((action) => (
                        <option key={action.id} value={action.id}>
                          {action.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    MIDI channel
                    <input
                      type="number"
                      min="1"
                      max="16"
                      value={channel}
                      onChange={(e) => setChannel(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    CC number
                    <input
                      type="number"
                      min="0"
                      max="127"
                      value={cc}
                      onChange={(e) => setCc(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    Knob mode
                    <select
                      value={mode}
                      onChange={(e) => setMode(e.target.value as typeof mode)}
                    >
                      <option value="absolute">Absolute</option>
                      <option value="relative_twos_complement">
                        Relative · two’s complement
                      </option>
                    </select>
                  </label>
                </div>
                <div className="form-grid">
                  <label className="field">
                    Mapped minimum (0–1)
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={minimum}
                      onChange={(e) => setMinimum(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    Mapped maximum (0–1)
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={maximum}
                      onChange={(e) => setMaximum(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    Scaling curve
                    <select
                      value={curve}
                      onChange={(e) => setCurve(e.target.value as typeof curve)}
                    >
                      <option value="linear">Linear</option>
                      <option value="logarithmic">
                        Logarithmic (minimum above zero)
                      </option>
                    </select>
                  </label>
                </div>
                <div className="performance-actions">
                  <Button
                    variant="outline"
                    disabled={!connected || !simulator}
                    onClick={() => {
                      learnArmed.current = !learnArmed.current;
                      setLearning(learnArmed.current);
                    }}
                  >
                    {learning ? 'Cancel MIDI learn' : 'Learn next MIDI message'}
                  </Button>
                  <span role="status">
                    {learning
                      ? 'Move a knob or send a simulator message…'
                      : state.last_midi
                        ? `Last input: CH ${state.last_midi.channel} / CC ${state.last_midi.cc} (${state.midi_mapped ? 'mapped' : 'unmapped'})`
                        : 'No MIDI input yet'}
                  </span>
                </div>
                <p className="caption">
                  Bypass and preset targets use absolute CC, linear 0–1 range,
                  and no pickup. Values below 64 select off/serial; 64–127
                  select on/parallel.
                </p>
                <div className="checkboxes">
                  <label>
                    <input
                      type="checkbox"
                      checked={pickup}
                      onChange={(e) => setPickup(e.target.checked)}
                    />
                    Pickup / soft takeover
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={feedback}
                      onChange={(e) => setFeedback(e.target.checked)}
                    />
                    Send controller feedback
                  </label>
                </div>
                <Button disabled={!connected} onClick={saveMapping}>
                  Save mapping
                </Button>
                <p className="caption">
                  Feedback updates supported displays, LEDs, or motors. Ordinary
                  knobs use pickup; they cannot physically follow web edits.
                </p>
              </section>
              <section className="panel">
                <h2>MIDI simulator</h2>
                <p>
                  Inject a CC message through the native control service. The
                  simulator does not require a connected controller.
                </p>
                <label className="field">
                  MIDI value
                  <input
                    aria-label="MIDI value"
                    type="number"
                    min="0"
                    max="127"
                    value={midiValue}
                    onChange={(e) => setMidiValue(Number(e.target.value))}
                  />
                </label>
                <Button
                  disabled={!connected || !simulator}
                  onClick={() =>
                    void run({
                      type: 'midi',
                      input: {
                        device: 'simulator',
                        channel,
                        cc,
                        value: midiValue,
                      },
                    })
                  }
                >
                  Send MIDI CC
                </Button>
                <div className="feedback" aria-label="MIDI feedback">
                  <span className="eyebrow">
                    Confirmed output / isolated feedback route
                  </span>
                  {state.feedback.length ? (
                    state.feedback.map((item) => (
                      <code key={item.mapping}>
                        CH {item.channel} · CC {item.cc} · VALUE{' '}
                        <span data-testid="feedback-value">{item.value}</span>
                      </code>
                    ))
                  ) : (
                    <span>No feedback yet</span>
                  )}
                </div>
              </section>
            </>
          )}
          <footer>
            <span>OXIDAL · LOCAL CONTROL PREVIEW</span>
            <span>
              REV {state?.revision ?? '—'} /{' '}
              {connected ? 'connected' : 'reconnecting'}
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
