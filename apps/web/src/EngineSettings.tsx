import { useEffect, useState } from 'react';
import {
  nativeDefaults,
  playbackCommand,
  playbackState,
  type AudioState,
  type NativeDefaults,
} from './api';
import { Button } from './components/ui/button';
import { formatDefault, settingHelp } from './engineHelp';
import { SettingDialog } from './SettingDialog';
import { ToolRow, ToolSection } from './ToolRow';

/**
 * The running native engine's unit-wide settings. They are kept across presets
 * and not saved in them, so they live in Settings rather than in Rig.
 * @see docs/native-tone3000.md
 */
export function EngineSettings({ connected }: { connected: boolean }) {
  const [state, setState] = useState<AudioState | null>(null);
  const [defaults, setDefaults] = useState<NativeDefaults | null>(null);
  const [editing, setEditing] = useState<{
    control: AudioState['controls'][number];
    session: string;
    revision: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void playbackState()
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {
        /* Shown as unavailable below. */
      });
    void nativeDefaults()
      .then((next) => {
        if (active) setDefaults(next);
      })
      .catch(() => {
        /* Defaults are optional context. */
      });
    return () => {
      active = false;
    };
  }, []);
  const settings =
    state?.phase === 'running'
      ? (state.authoring?.settings ?? []).filter(
          (setting) => !setting.target.startsWith('block:'),
        )
      : [];
  return (
    <ToolSection
      title="Running engine"
      scope="This unit · kept across presets, not saved in them"
    >
      {settings.length ? (
        <>
          <p className="tool-row-detail">
            Applying a change restarts audio briefly. Device defaults below are
            what a fresh start uses.
          </p>
          <div role="group" aria-label="Prepared DSP settings">
            {settings.map((setting) => {
              const raw = defaults?.settings.parameters[setting.target];
              const shown =
                raw != null && Math.abs(raw - setting.value) > 1e-4
                  ? formatDefault(setting.target, raw)
                  : null;
              return (
                <ToolRow
                  inline
                  key={setting.target}
                  title={setting.label}
                  value={setting.display}
                  detail={
                    <>
                      {settingHelp[setting.target] ?? 'Engine setting.'}
                      {shown && ` Device default: ${shown}.`}
                    </>
                  }
                >
                  <Button
                    variant="outline"
                    aria-label={`${setting.label} · ${setting.display}`}
                    disabled={!connected || busy}
                    onClick={() =>
                      state &&
                      setEditing({
                        control: setting,
                        session: state.session,
                        revision: state.revision,
                      })
                    }
                  >
                    Change…
                  </Button>
                </ToolRow>
              );
            })}
          </div>
        </>
      ) : (
        <p className="tool-row-detail">
          Start a TONE3000 rig to change the running engine. The device defaults
          below apply whenever audio starts.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {editing && state && (
        <SettingDialog
          control={editing.control}
          detail={settingHelp[editing.control.target]}
          step={state.authoring?.setting_steps?.[editing.control.target]}
          busy={busy}
          stale={
            state.session !== editing.session ||
            state.revision !== editing.revision
          }
          onCancel={() => setEditing(null)}
          onApply={async (value) => {
            setBusy(true);
            setError('');
            try {
              setState(
                await playbackCommand(state, {
                  kind: 'authoring',
                  action: {
                    kind: 'parameter',
                    parameter: editing.control.target,
                    value,
                  },
                }),
              );
              setEditing(null);
            } catch (cause) {
              setError(String(cause));
              try {
                setState(await playbackState());
              } catch {
                /* Keep the last confirmed state. */
              }
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </ToolSection>
  );
}
