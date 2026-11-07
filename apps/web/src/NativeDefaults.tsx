import { friendlyError } from './lib/friendlyError';
import { useEffect, useState } from 'react';
import { nativeDefaults, type NativeDefaults as Defaults } from './api';
import { Button } from './components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { Switch } from './components/ui/switch';
const QUALITY_DEFAULTS: Defaults['settings'] = {
  nam_size: 1,
  multi_core: true,
  parameters: { osEnabled: 1, osFactor: 1 },
};
/** Device defaults apply at the next native instance, separately from live tone edits. */
/** Oversampling factors the engine supports, as stored (0, 0.5, 1). */
const OVERSAMPLING: [number, string][] = [
  [0, '2×'],
  [0.5, '4×'],
  [1, '8×'],
];

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
        if (active) setMessage(friendlyError(e, 'read the NAM block defaults'));
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
        settings: reset ? QUALITY_DEFAULTS : draft,
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
  // Pending: edited here but not saved, so nothing uses it yet.
  const pending =
    !!draft &&
    !!state &&
    JSON.stringify(draft) !== JSON.stringify(state.settings);
  const enabled = (draft?.parameters.osEnabled ?? 0) === 1;
  const factor = draft?.parameters.osFactor ?? 0;
  const listed = OVERSAMPLING.find(
    ([value]) => Math.abs(value - factor) < 1e-4,
  );
  const oversampling = !enabled ? 'off' : listed ? String(listed[0]) : 'other';
  function parameter(id: string, value: number) {
    if (draft)
      setDraft({ ...draft, parameters: { ...draft.parameters, [id]: value } });
  }
  return (
    <section
      className="control-stack border-t border-border pt-4"
      aria-labelledby="native-defaults"
    >
      <h3 id="native-defaults">Defaults for new NAM blocks</h3>
      <p className="text-muted-foreground">
        NAM blocks added from now on start with these settings. Presets keep
        their own saved settings, and what is playing now does not change. The
        factory default is Full A2 at 8× oversampling; dense presets can use
        Lite or less oversampling when processing load requires it.
      </p>
      <p className="caption">
        A preset saved at 2× while the default is 8× is not a conflict: the
        preset&apos;s own setting overrides the default when it plays.
      </p>
      {draft && (
        <fieldset disabled={!connected || busy} className="control-stack">
          <label className="field">
            NAM size for new models
            <Select
              value={String(draft.nam_size)}
              onValueChange={(value) =>
                setDraft({ ...draft, nam_size: Number(value) })
              }
            >
              <SelectTrigger aria-label="NAM size for new models">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Lite</SelectItem>
                <SelectItem value="0.25">25%</SelectItem>
                <SelectItem value="0.5">50%</SelectItem>
                <SelectItem value="0.75">75%</SelectItem>
                <SelectItem value="1">Full</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>Native multi-core processing</span>
            <Switch
              checked={draft.multi_core}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, multi_core: checked })
              }
              aria-label="Native multi-core processing"
            />
          </label>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>Input calibration</span>
            <Switch
              checked={(draft.parameters.calibrateInput ?? 0) === 1}
              onCheckedChange={(checked) =>
                parameter('calibrateInput', checked ? 1 : 0)
              }
              aria-label="Input calibration"
            />
          </label>
          <label className="field">
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
          <label className="field">
            Oversampling
            <Select
              value={oversampling}
              onValueChange={(value) => {
                if (value === 'off') parameter('osEnabled', 0);
                else if (value !== 'other')
                  setDraft({
                    ...draft,
                    parameters: {
                      ...draft.parameters,
                      osEnabled: 1,
                      osFactor: Number(value),
                    },
                  });
              }}
            >
              <SelectTrigger aria-label="Oversampling">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                {OVERSAMPLING.map(([value, label]) => (
                  <SelectItem key={value} value={String(value)}>
                    {label}
                  </SelectItem>
                ))}
                {oversampling === 'other' && (
                  <SelectItem value="other">
                    Other ({draft.parameters.osFactor})
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </label>
          {oversampling === 'other' && (
            <p className="caption">
              The saved default uses a factor this screen does not list. It is
              kept unless you choose another.
            </p>
          )}
          {pending && (
            <p className="caption">
              Unsaved changes · nothing uses them until you save.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={!pending} onClick={() => void save()}>
              Save device defaults
            </Button>
            {pending && state && (
              <Button variant="ghost" onClick={() => setDraft(state.settings)}>
                Discard changes
              </Button>
            )}
            <Button variant="outline" onClick={() => void save(true)}>
              Reset defaults
            </Button>
          </div>
        </fieldset>
      )}
      <p role="status">{busy ? 'Saving…' : message}</p>
    </section>
  );
}
