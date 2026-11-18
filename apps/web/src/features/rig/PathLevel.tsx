import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';

import { panLabel } from '../../lib/panLabel';
import { mixGains, type PathMix, pathMix } from '../../rigRoute';

/** A path's level into its merge, set on both channels when released (7.26).
 * Live and unsaved until Save, like every other control.
 * @see docs/interface.md
 */
/**
 * A silent path's gains are 0 and 0, which cannot carry its polarity or pan.
 * They are remembered here by path while the page is open, so a path taken to
 * 0 and raised again is still inverted and still panned.
 */
const silent = new Map<string, PathMix>();

export function PathLevel({
  id,
  path,
  left,
  right,
  disabled,
  onCommit,
}: {
  /** The path's merge and port, to remember its polarity and pan at level 0. */
  id?: string;
  path: number;
  /** The path's left and right merge gains. */
  left: number;
  right: number;
  disabled: boolean;
  onCommit: (left: number, right: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => {
    const read = pathMix(left, right);
    // A path heard again was set elsewhere: what was remembered is stale.
    if (id && read.level !== 0) silent.delete(id);
    const kept = id ? silent.get(id) : undefined;
    return kept ? { ...kept, level: 0 } : read;
  });
  const commit = (mix: PathMix = draft) => {
    const [l, r] = mixGains(mix);
    if (id && mix.level === 0) silent.set(id, mix);
    else if (id) silent.delete(id);
    if (Math.abs(l - left) > 0.0001 || Math.abs(r - right) > 0.0001)
      void onCommit(l, r);
  };
  /** Step buttons for E-paper, where there is no dragging. */
  const step = (
    key: 'level' | 'pan',
    delta: number,
    lo: number,
    hi: number,
  ) => {
    const next = {
      ...draft,
      [key]: Math.min(
        hi,
        Math.max(lo, Math.round((draft[key] + delta) * 20) / 20),
      ),
    };
    setDraft(next);
    commit(next);
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
        <span className="path-mix-steps">
          <Button
            variant="outline"
            size="icon"
            aria-label={`Lower path ${path} level`}
            disabled={disabled}
            onClick={() => step('level', -0.1, 0, 2)}
          >
            −
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Raise path ${path} level`}
            disabled={disabled}
            onClick={() => step('level', 0.1, 0, 2)}
          >
            +
          </Button>
        </span>
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
        <span className="path-mix-steps">
          <Button
            variant="outline"
            size="icon"
            aria-label={`Pan path ${path} left`}
            disabled={disabled}
            onClick={() => step('pan', -0.1, -1, 1)}
          >
            L
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Pan path ${path} right`}
            disabled={disabled}
            onClick={() => step('pan', 0.1, -1, 1)}
          >
            R
          </Button>
        </span>
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
