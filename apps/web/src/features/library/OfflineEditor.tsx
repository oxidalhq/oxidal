import { useEffect, useState } from 'react';
import {
  installedLv2,
  libraryCatalog,
  publishRig,
  rigDocument,
  rigLibrary,
  type Lv2Plugin,
  type RigDocument,
} from '../../api';
import { AdjustmentDialog } from '../../AdjustmentDialog';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/ui/loading';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { friendlyError } from '../../lib/friendlyError';
import { lv2Effect, type DraftEffect } from '../../rigDraft';
import {
  buildRoute,
  isSplit,
  readRoute,
  routeAddPath,
  routeAppend,
  routeControl,
  routePath,
  routePathGain,
  routeRemove,
  routeShift,
  type Route,
  type RouteSplit,
} from '../../rigRoute';
import { presetNameError } from './newPreset';

/** The scan rate for plugin metadata; nothing is processed here. */
const METADATA_RATE = 48000;

type Opened = {
  document: RigDocument;
  plugins: Lv2Plugin[];
  profile: string;
  mine: boolean;
};

/**
 * Edit a saved preset without playing it (7.3): the routing, its effects and
 * their settings change in a draft held here, and only Save publishes a new
 * revision. Nothing starts, stops or switches audio. A preset of your own keeps
 * its identity (the saved revision replaces it in the Set list); any other
 * preset is saved as a copy in Mine. Scene presets are edited in Rig, where
 * their scene snapshots stay consistent with the routing.
 * @see docs/presets/format.md
 */
export function OfflineEditor({
  revision,
  connected,
  onSaved,
  onCancel,
}: {
  revision: string;
  connected: boolean;
  onSaved: (saved: RigDocument) => void;
  onCancel: () => void;
}) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [route, setRoute] = useState<Route>([]);
  const [name, setName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState('');
  const [discarding, setDiscarding] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [document, plugins, library, catalog] = await Promise.all([
        rigDocument(revision),
        // Effects need plugin metadata; a preset without them opens anyway.
        installedLv2(METADATA_RATE).catch(() => [] as Lv2Plugin[]),
        rigLibrary(),
        libraryCatalog(),
      ]);
      if (!alive) return;
      const listed = catalog.items.find(
        (i) => i.kind === 'rig' && i.id === revision,
      );
      setName(listed?.name ?? document.manifest.name);
      if (document.manifest.extensions['urn:oxidal:scenes:1']) {
        setBlocked(
          'This preset has scenes. Edit it in Rig, where each scene’s mix stays matched to its routing.',
        );
        return;
      }
      setRoute(readRoute(document, plugins, {}));
      setOpened({
        document,
        plugins,
        profile: library.native_profile,
        mine: (listed?.origin ?? 'mine') === 'mine',
      });
    })().catch((cause: unknown) => {
      if (alive) setBlocked(friendlyError(cause, 'open this preset'));
    });
    return () => {
      alive = false;
    };
  }, [revision]);
  function change(edit: (route: Route) => Route) {
    setError('');
    setRoute((current) => {
      try {
        const next = edit(current);
        if (next !== current) setDirty(true);
        return next;
      } catch (cause) {
        setError(friendlyError(cause, 'change the routing'));
        return current;
      }
    });
  }
  async function save() {
    const nameError = presetNameError(name);
    if (!opened || busy) return;
    if (nameError) {
      setError(nameError);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const id = opened.mine
        ? opened.document.manifest.id
        : crypto.randomUUID();
      const request = buildRoute(id, name, route, opened.profile);
      request.source = { kind: 'rig', id: opened.document.revision };
      onSaved(await publishRig(request));
    } catch (cause) {
      // The draft stays open so nothing is lost.
      setError(friendlyError(cause, 'save the preset'));
    } finally {
      setBusy(false);
    }
  }
  const usable = opened?.plugins.filter((p) => !p.unsupported) ?? [];
  const effect = (uri: string): DraftEffect | null => {
    const plugin = usable.find((p) => p.uri === uri);
    return plugin ? lv2Effect(plugin) : null;
  };
  function addEffect(at?: { split: string; path: number }) {
    const key = at ? `${at.split}:${at.path}` : 'end';
    return (
      <Select
        value=""
        onValueChange={(uri) => {
          const made = effect(uri);
          if (made) change((r) => routeAppend(r, made, at));
          setAdding('');
        }}
        open={adding === key}
        onOpenChange={(open) => setAdding(open ? key : '')}
      >
        <SelectTrigger
          aria-label={
            at
              ? `Add an effect to path ${at.path + 1}`
              : 'Add an effect at the end'
          }
          className="w-auto"
          disabled={busy || !usable.length}
        >
          <SelectValue placeholder="+ Effect" />
        </SelectTrigger>
        <SelectContent>
          {usable.map((p) => (
            <SelectItem key={p.uri} value={p.uri}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  function block(item: DraftEffect, first: boolean, last: boolean) {
    const block = item;
    const ports =
      block.kind === 'lv2'
        ? block.plugin.ports.filter(
            (p) =>
              p.control && p.input && p.minimum != null && p.maximum != null,
          )
        : [];
    return (
      <li key={block.id} className="offline-block">
        <div className="offline-row">
          <strong>{block.name}</strong>
          <span className="caption">
            {block.kind === 'native'
              ? block.stage
                ? `TONE3000 ${block.stage.role} stage`
                : 'TONE3000'
              : 'Effect'}
          </span>
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            aria-label={`Move ${block.name} earlier`}
            disabled={busy || first}
            onClick={() => change((r) => routeShift(r, block.id, -1))}
          >
            ↑
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Move ${block.name} later`}
            disabled={busy || last}
            onClick={() => change((r) => routeShift(r, block.id, 1))}
          >
            ↓
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Add a parallel path beside ${block.name}`}
            disabled={busy}
            onClick={() => change((r) => routeAddPath(r, block.id))}
          >
            Parallel path
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Remove ${block.name}`}
            disabled={busy}
            onClick={() => change((r) => routeRemove(r, block.id))}
          >
            Remove
          </Button>
        </div>
        {!!ports.length && block.kind === 'lv2' && (
          <details>
            <summary>Settings</summary>
            <div className="control-stack">
              {ports.map((p) => (
                <label key={p.symbol} className="field">
                  <span>
                    {p.symbol} · {block.controls[p.symbol] ?? p.default}
                  </span>
                  <input
                    type="range"
                    aria-label={`${block.name} ${p.symbol}`}
                    min={p.minimum!}
                    max={p.maximum!}
                    step={
                      p.integer || p.toggled
                        ? 1
                        : (p.maximum! - p.minimum!) / 100
                    }
                    value={block.controls[p.symbol] ?? p.default ?? p.minimum!}
                    disabled={busy}
                    onChange={(event) =>
                      change((r) =>
                        routeControl(
                          r,
                          block.id,
                          p.symbol,
                          Number(event.target.value),
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </details>
        )}
      </li>
    );
  }
  function split(step: RouteSplit) {
    return (
      <li key={step.split} className="offline-split">
        <span className="caption">Split · {step.branches.length} paths</span>
        <ol className="offline-paths">
          {step.branches.map((branch, path) => (
            <li key={path} aria-label={`Path ${path + 1}`}>
              <div className="offline-row">
                <span>Path {path + 1}</span>
                {!branch.length && (
                  <span className="caption">Dry · no blocks</span>
                )}
                <span className="flex-1" />
                {addEffect({ split: step.split, path })}
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Copy path ${path + 1}`}
                  disabled={busy}
                  onClick={() =>
                    change((r) => routePath(r, step.split, path, 'copy'))
                  }
                >
                  Copy
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove path ${path + 1}`}
                  disabled={busy}
                  onClick={() =>
                    change((r) => routePath(r, step.split, path, 'remove'))
                  }
                >
                  Remove
                </Button>
              </div>
              <label className="field">
                <span>
                  Path {path + 1} level ·{' '}
                  {Math.round((step.gains[path] ?? 1) * 100)}%
                </span>
                <input
                  type="range"
                  aria-label={`Path ${path + 1} level`}
                  min={0}
                  max={2}
                  step={0.05}
                  value={step.gains[path] ?? 1}
                  disabled={busy}
                  onChange={(event) =>
                    change((r) =>
                      routePathGain(
                        r,
                        step.split,
                        path,
                        Number(event.target.value),
                      ),
                    )
                  }
                />
              </label>
              {steps(branch)}
            </li>
          ))}
        </ol>
      </li>
    );
  }
  function steps(list: Route) {
    if (!list.length) return null;
    return (
      <ol className="offline-steps">
        {list.map((step, index) =>
          isSplit(step)
            ? split(step)
            : block(step, index === 0, index === list.length - 1),
        )}
      </ol>
    );
  }
  const close = () => (dirty ? setDiscarding(true) : onCancel());
  return (
    <AdjustmentDialog
      title="Edit without playing"
      onCancel={() => !busy && close()}
    >
      {blocked ? (
        <>
          <p role="alert">{blocked}</p>
          <div className="action-row">
            <Button onClick={onCancel}>Close</Button>
          </div>
        </>
      ) : !opened ? (
        <Loading label="Opening the preset" />
      ) : (
        <form
          className="control-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="field">
            <span>Name</span>
            <input
              className="h-11 w-full rounded-md border border-input bg-card px-3"
              value={name}
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
                setDirty(true);
              }}
            />
          </label>
          <p className="caption">
            Nothing plays while you edit. Save keeps the changes
            {opened.mine ? '.' : ' as your own copy in Mine.'}
          </p>
          <div aria-label="Routing" role="group">
            <div className="offline-row">
              <span className="caption">Input</span>
            </div>
            {route.length ? (
              steps(route)
            ) : (
              <p className="caption">Input straight to output.</p>
            )}
            <div className="offline-row">
              <span className="caption">Output</span>
              <span className="flex-1" />
              {addEffect()}
            </div>
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="action-row">
            <span className="flex-1" />
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!connected || busy || !dirty}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      )}
      {discarding && (
        <AdjustmentDialog
          title="Discard your edits?"
          onCancel={() => setDiscarding(false)}
        >
          <p>The saved preset stays as it was.</p>
          <div className="action-row">
            <Button variant="outline" onClick={() => setDiscarding(false)}>
              Keep editing
            </Button>
            <Button onClick={onCancel}>Discard</Button>
          </div>
        </AdjustmentDialog>
      )}
    </AdjustmentDialog>
  );
}
