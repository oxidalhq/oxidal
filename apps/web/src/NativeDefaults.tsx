import { useEffect, useState } from 'react';
import { nativeDefaults, type NativeDefaults as Defaults } from './api';
import { Button } from './components/ui/button';
/** Device defaults apply at the next native instance, separately from live tone edits. */
export function NativeDefaults({ connected }: { connected: boolean }) {
  const [state, setState] = useState<Defaults | null>(null);
  const [draft, setDraft] = useState<Defaults['settings'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void nativeDefaults()
      .then((s) => {
        if (active) {
          setState(s);
          setDraft(s.settings);
        }
      })
      .catch((e) => {
        if (active) setMessage(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  async function save(reset = false) {
    if (!state || !draft) return;
    setBusy(true);
    setMessage('');
    try {
      const next = await nativeDefaults({
        expected_revision: state.revision,
        settings: reset
          ? { nam_size: 0, multi_core: false, parameters: {} }
          : draft,
      });
      setState(next);
      setDraft(next.settings);
      setMessage(
        'Defaults saved · used at the next audio start or new preset.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Cannot save defaults');
    } finally {
      setBusy(false);
    }
  }
  function parameter(id: string, value: number) {
    if (draft)
      setDraft({ ...draft, parameters: { ...draft.parameters, [id]: value } });
  }
  return (
    <details className="panel control-stack">
      <summary>TONE3000 device defaults</summary>
      <p className="text-muted-foreground">
        New native instances use these defaults. Saved tone and session settings
        take priority; playing audio stays unchanged.
      </p>
      {draft && (
        <fieldset disabled={!connected || busy} className="control-stack">
          <label>
            NAM size for new models
            <select
              value={draft.nam_size}
              onChange={(e) =>
                setDraft({ ...draft, nam_size: Number(e.target.value) })
              }
            >
              <option value={0}>Lite</option>
              <option value={0.25}>25%</option>
              <option value={0.5}>50%</option>
              <option value={0.75}>75%</option>
              <option value={1}>Full</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.multi_core}
              onChange={(e) =>
                setDraft({ ...draft, multi_core: e.target.checked })
              }
            />{' '}
            Native multi-core processing
          </label>
          <label>
            <input
              type="checkbox"
              checked={(draft.parameters.calibrateInput ?? 0) === 1}
              onChange={(e) =>
                parameter('calibrateInput', e.target.checked ? 1 : 0)
              }
            />{' '}
            Input calibration
          </label>
          <label>
            Input calibration (dBu)
            <input
              type="number"
              min={-60}
              max={60}
              step={0.01}
              value={Number(
                (
                  (draft.parameters.inputCalibrationLevel ?? 0.6) * 120 -
                  60
                ).toFixed(2),
              )}
              onChange={(e) => {
                if (e.target.value !== '')
                  parameter(
                    'inputCalibrationLevel',
                    (Number(e.target.value) + 60) / 120,
                  );
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={(draft.parameters.osEnabled ?? 0) === 1}
              onChange={(e) => parameter('osEnabled', e.target.checked ? 1 : 0)}
            />{' '}
            Oversampling
          </label>
          <label>
            Oversampling factor
            <select
              value={draft.parameters.osFactor ?? 0}
              onChange={(e) => parameter('osFactor', Number(e.target.value))}
            >
              <option value={0}>2×</option>
              <option value={0.5}>4×</option>
              <option value={1}>8×</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()}>Save device defaults</Button>
            <Button variant="outline" onClick={() => void save(true)}>
              Reset defaults
            </Button>
          </div>
        </fieldset>
      )}
      <p role="status">{busy ? 'Saving…' : message}</p>
    </details>
  );
}
