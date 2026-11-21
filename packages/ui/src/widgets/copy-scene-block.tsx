import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';

type Option = { id: string; name: string };
export type SceneBlockCopySelection = {
  sourceBlock: string;
  destinationScene: string;
  destinationBlock: string;
  version: string;
};
export type SceneBlockCopyPreview =
  | { refusal: string }
  | { rows: { id: string; label: string; before: string; after: string }[] };

function Choice({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly Option[];
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm font-medium">
      {label}
      <select
        className="min-h-touch w-full rounded-md border border-input bg-card px-3 py-2"
        value={value}
        disabled={disabled || !options.length}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          Choose…
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Review an independent copy before publishing it to the selected saved version. */
export function CopySceneBlockDialog({
  sourceScene,
  sourceBlocks,
  destinationScenes,
  destinationBlocks,
  versions,
  selection,
  preview,
  loading,
  saving,
  error,
  disabled,
  onChange,
  onCancel,
  onCopy,
}: {
  sourceScene: string;
  sourceBlocks: readonly Option[];
  destinationScenes: readonly Option[];
  destinationBlocks: readonly Option[];
  versions: readonly Option[];
  selection: SceneBlockCopySelection;
  preview: SceneBlockCopyPreview | null;
  loading?: boolean;
  saving?: boolean;
  error?: string;
  disabled?: boolean;
  onChange: (selection: SceneBlockCopySelection) => void;
  onCancel: () => void;
  onCopy: () => void;
}) {
  const fields = [
    ['sourceBlock', 'Source block', sourceBlocks],
    ['destinationScene', 'Destination scene', destinationScenes],
    ['destinationBlock', 'Destination block', destinationBlocks],
    ['version', 'Version to update', versions],
  ] as const;
  const rows = preview && 'rows' in preview ? preview.rows : [];
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent>
        <DialogHeader
          title="Copy block settings"
          description={`Copy settings saved in ${sourceScene}.`}
          closable={!saving}
        />
        <DialogBody className="min-h-0">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {fields.map(([key, label, options]) => (
              <Choice
                key={key}
                label={label}
                value={selection[key]}
                options={options}
                disabled={!!saving}
                onChange={(value) =>
                  onChange({
                    ...selection,
                    [key]: value,
                    ...(key === 'sourceBlock'
                      ? { destinationBlock: value }
                      : {}),
                  })
                }
              />
            ))}
          </div>
          {loading && <p role="status">Reading saved versions and effects…</p>}
          {!sourceBlocks.length && (
            <p role="status">
              This scene has no saved effect settings to copy.
            </p>
          )}
          {preview && 'refusal' in preview && (
            <p role="status">{preview.refusal}</p>
          )}
          {!!rows.length && (
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <caption className="mb-2 text-left font-semibold">
                Settings to copy
              </caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-2">
                    Setting
                  </th>
                  <th scope="col" className="py-2 pr-2">
                    Destination
                  </th>
                  <th scope="col" className="py-2">
                    Copied value
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border">
                    <th
                      scope="row"
                      className="py-2 pr-2 font-medium wrap-break-word"
                    >
                      {row.label}
                    </th>
                    <td className="py-2 pr-2 font-mono wrap-break-word">
                      {row.before}
                    </td>
                    <td className="py-2 font-mono wrap-break-word">
                      {row.after}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {error && <p role="alert">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={
              disabled ||
              loading ||
              saving ||
              !selection.version ||
              !rows.length
            }
            onClick={onCopy}
          >
            {saving ? 'Saving…' : 'Copy and save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
