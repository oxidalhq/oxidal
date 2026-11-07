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
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>Oversampling</span>
            <Switch
              checked={(draft.parameters.osEnabled ?? 0) === 1}
              onCheckedChange={(checked) =>
                parameter('osEnabled', checked ? 1 : 0)
              }
              aria-label="Oversampling"
            />
          </label>
          <label className="field">
            Oversampling factor
            <Select
              value={String(draft.parameters.osFactor ?? 0)}
              onValueChange={(value) => parameter('osFactor', Number(value))}
            >
              <SelectTrigger aria-label="Oversampling factor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">2×</SelectItem>
                <SelectItem value="0.5">4×</SelectItem>
                <SelectItem value="1">8×</SelectItem>
              </SelectContent>
            </Select>
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
    </section>
  );
}
