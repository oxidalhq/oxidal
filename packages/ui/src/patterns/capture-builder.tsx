import { useState } from 'react';

import { Button } from '../components/ui/button';

const sceneNames = ['Clean', 'Crunch', 'Lead', 'Dirt'] as const;
type Role = 'amp' | 'full_rig';
export type CaptureChoice = { id: string; name: string; role?: Role };
type CaptureSlot = { asset: string; role: Role };
export type CapturePlan = {
  name: string;
  captures: [CaptureSlot, CaptureSlot, CaptureSlot, CaptureSlot];
  cabinet?: string;
};

export function CaptureBuilder({
  models,
  cabinets,
  busy,
  error,
  onSave,
  onCancel,
  search,
  more,
  onMore,
  onSearch,
  cabinetMore,
  onMoreCabinets,
  loading,
}: {
  models: CaptureChoice[];
  cabinets: { id: string; name: string }[];
  busy: boolean;
  error?: string;
  search: string;
  more: boolean;
  cabinetMore?: boolean;
  onMoreCabinets?: () => void;
  loading?: boolean;
  onMore: () => void;
  onSearch: (text: string) => void;
  onSave: (plan: CapturePlan) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [rows, setRows] = useState<(CaptureChoice | undefined)[]>(
    Array.from({ length: 4 }),
  );
  const [current, setCurrent] = useState(0);
  const [fixed, setFixed] = useState<boolean[]>([false, false, false, false]);
  const [cabinet, setCabinet] = useState('');
  const amp = rows.some((row) => row?.role === 'amp');
  const ready = name.trim() && rows.every((row) => row?.role);
  function assign(index: number, value: CaptureChoice) {
    setRows((old) => old.map((row, i) => (i === index ? value : row)));
  }
  return (
    <fieldset className="grid min-w-0 gap-3">
      <legend className="sr-only">Scene assignments and shared cabinet</legend>
      <fieldset disabled={busy} className="grid min-w-0 gap-3">
        <label>
          Rig name{' '}
          <input
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div
          role="group"
          aria-label="Scene assignments"
          className="grid gap-2 sm:grid-cols-2"
        >
          {sceneNames.map((scene, i) => (
            <div key={scene} className="grid min-w-0 gap-1">
              <Button
                variant="outline"
                aria-pressed={current === i}
                onClick={() => setCurrent(i)}
              >
                {scene} · {rows[i]?.name ?? 'Choose capture'}
              </Button>
              {rows[i] && (
                <label>
                  {scene} capture type
                  <select
                    disabled={fixed[i]}
                    value={rows[i]?.role ?? ''}
                    onChange={(e) => {
                      const role = e.target.value;
                      if (role === 'amp' || role === 'full_rig')
                        assign(i, { ...rows[i]!, role });
                    }}
                  >
                    <option value="" disabled>
                      Confirm capture type
                    </option>
                    <option value="amp">Amp only</option>
                    <option value="full_rig">Amp and cabinet</option>
                  </select>
                </label>
              )}
            </div>
          ))}
        </div>
        <label>
          Find a local capture for {sceneNames[current]}
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>
        <div
          className="grid max-h-48 gap-1 overflow-auto"
          role="group"
          aria-label="Local captures"
        >
          {models.map((model) => (
            <Button
              variant="outline"
              key={model.id}
              onClick={() => {
                assign(current, model);
                setFixed((old) =>
                  old.map((v, i) => (i === current ? !!model.role : v)),
                );
              }}
            >
              {model.name}
            </Button>
          ))}
          {!models.length && (
            <span>
              {loading ? 'Loading captures…' : 'No matching amp captures'}
            </span>
          )}
          {more && (
            <Button variant="outline" onClick={onMore}>
              More captures
            </Button>
          )}
        </div>
        {amp && (
          <label>
            Shared cabinet for amp-only scenes
            <select
              value={cabinet}
              onChange={(e) => setCabinet(e.target.value)}
            >
              <option value="">Use amp output directly</option>
              {cabinets.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {amp && cabinetMore && (
          <Button variant="outline" onClick={onMoreCabinets}>
            More cabinets
          </Button>
        )}
        <p>All four scenes feed Echo and Bloom.</p>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!ready || busy}
          onClick={() => {
            const slots = rows.map((row) =>
              row?.role ? { asset: row.id, role: row.role } : undefined,
            );
            const [clean, crunch, lead, dirt] = slots;
            if (ready && clean && crunch && lead && dirt)
              onSave({
                name: name.trim(),
                captures: [clean, crunch, lead, dirt],
                ...(amp && cabinet ? { cabinet } : {}),
              });
          }}
        >
          {busy ? 'Saving rig…' : 'Save rig'}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}
