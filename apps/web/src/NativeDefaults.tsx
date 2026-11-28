import { useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@oxidal/design-system/components/select';
import { Switch } from '@oxidal/design-system/components/switch';
import { Caption } from '@oxidal/design-system/components/text';
import {
  SettingGroup,
  SettingRow,
} from '@oxidal/design-system/patterns/settings-page';

import { type NativeDefaults as Defaults, nativeDefaults } from './api';
import { friendlyError } from './lib/friendlyError';
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
    <section aria-label="Defaults for new NAM blocks" className="grid min-w-0">
      <SettingGroup title="Defaults for new NAM blocks">
        <Caption className="mb-1 max-w-prose text-xs">
          NAM blocks added from now on start with these settings. Presets keep
          their own saved settings, and what is playing now does not change. The
          factory default is Full A2 at 8× oversampling; dense presets can use
          Lite or less oversampling when processing load requires it. A preset
          saved at 2× while the default is 8× is not a conflict: the
          preset&apos;s own setting overrides the default when it plays.
        </Caption>
        {draft && (
          <fieldset disabled={!connected || busy} className="grid min-w-0">
            <SettingRow id="nam-size" label="NAM size for new models">
              <Select
                value={String(draft.nam_size)}
                onValueChange={(value) =>
                  setDraft({ ...draft, nam_size: Number(value) })
                }
              >
                <SelectTrigger
                  id="nam-size"
                  size="sm"
                  aria-label="NAM size for new models"
                  className="w-40"
                >
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
            </SettingRow>
            <SettingRow
              id="nam-multi-core"
              label="Native multi-core processing"
              caption="Spreads NAM blocks over the Pi's cores."
            >
              <Switch
                id="nam-multi-core"
                checked={draft.multi_core}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, multi_core: checked })
                }
                aria-label="Native multi-core processing"
              />
            </SettingRow>
            <SettingRow
              id="nam-calibrate"
              label="Input calibration"
              caption="Matches your interface's input level to the capture's."
            >
              <Switch
                id="nam-calibrate"
                checked={(draft.parameters.calibrateInput ?? 0) === 1}
                onCheckedChange={(checked) =>
                  parameter('calibrateInput', checked ? 1 : 0)
                }
                aria-label="Input calibration"
              />
            </SettingRow>
            <SettingRow
              id="nam-calibration-level"
              label="Input calibration level"
              caption="In dBu, as your interface's manual gives it."
            >
              <input
                id="nam-calibration-level"
                aria-label="Input calibration (dBu)"
                type="number"
                min={-60}
                max={60}
                step={0.01}
                className="h-control w-28 rounded-lg border border-input bg-card px-3 text-right font-mono text-sm tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-touch"
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
            </SettingRow>
            <SettingRow
              id="nam-oversampling"
              label="Oversampling"
              caption={
                oversampling === 'other'
                  ? 'The saved default uses a factor this screen does not list. It is kept unless you choose another.'
                  : 'Higher is cleaner and costs more processing.'
              }
            >
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
                <SelectTrigger
                  id="nam-oversampling"
                  size="sm"
                  aria-label="Oversampling"
                  className="w-40"
                >
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
            </SettingRow>
            <div className="flex flex-wrap items-center gap-2 py-3">
              <Button size="sm" disabled={!pending} onClick={() => void save()}>
                Save device defaults
              </Button>
              {pending && state && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDraft(state.settings)}
                >
                  Discard changes
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void save(true)}
              >
                Reset defaults
              </Button>
              {pending && (
                <Caption as="span" className="text-xs">
                  Unsaved changes · nothing uses them until you save.
                </Caption>
              )}
            </div>
          </fieldset>
        )}
        <p
          role="status"
          className="m-0 text-sm text-muted-foreground empty:hidden"
        >
          {busy ? 'Saving…' : message}
        </p>
      </SettingGroup>
    </section>
  );
}
