import { type PathMix, mixGains, pathMix } from '../../rigRoute';
import { panLabel } from '../../lib/panLabel';
import { useState } from 'react';

/** A path's level into its merge, set on both channels when released (7.26).
 * Live and unsaved until Save, like every other control.
 * @see docs/interface.md
 */
export function PathLevel({
  path,
  left,
  right,
  disabled,
  onCommit,
}: {
  path: number;
  /** The path's left and right merge gains. */
  left: number;
  right: number;
  disabled: boolean;
  onCommit: (left: number, right: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => pathMix(left, right));
  const commit = (mix: PathMix = draft) => {
    const [l, r] = mixGains(mix);
    if (Math.abs(l - left) > 0.0001 || Math.abs(r - right) > 0.0001)
      void onCommit(l, r);
  };
  return (
    <div className="path-mix" role="group" aria-label={`Path ${path} mix`}>
      <label className="field">
        <span>
          Path {path} level · {Math.round(draft.level * 100)}%
        </span>
        <input
          type="range"
          aria-label={`Path ${path} level`}
          min={0}
          max={2}
          step={0.05}
          value={draft.level}
          disabled={disabled}
          onChange={(event) =>
            setDraft({ ...draft, level: Number(event.target.value) })
          }
          onPointerUp={() => commit()}
          onKeyUp={() => commit()}
          onBlur={() => commit()}
        />
      </label>
      <label className="field">
        <span>
          Path {path} pan · {panLabel(draft.pan)}
        </span>
        <input
          type="range"
          aria-label={`Path ${path} pan`}
          min={-1}
          max={1}
          step={0.05}
          value={draft.pan}
          disabled={disabled}
          onChange={(event) =>
            setDraft({ ...draft, pan: Number(event.target.value) })
          }
          onPointerUp={() => commit()}
          onKeyUp={() => commit()}
          onBlur={() => commit()}
        />
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          aria-label={`Invert path ${path} polarity`}
          checked={draft.invert}
          disabled={disabled}
          onChange={(event) => {
            const next = { ...draft, invert: event.target.checked };
            setDraft(next);
            commit(next);
          }}
        />
        Invert polarity
      </label>
    </div>
  );
}
