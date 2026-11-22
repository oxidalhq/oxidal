import { useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';

import { blockSettings } from '../../api';
import type { Contract } from '../../generated/contract';
import type { DraftEffect } from '../../rigDraft';
import { namedSettingValues } from './namedSettingValues';

export function NamedSettings({
  block,
  disabled,
  onApply,
}: {
  block: Extract<DraftEffect, { kind: 'lv2' }>;
  disabled: boolean;
  onApply: (values: Record<string, number>) => void;
}) {
  const [library, setLibrary] = useState<Contract['block_settings']>();
  const [name, setName] = useState('');
  const [selected, select] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState('');
  const [undo, setUndo] = useState<{
    before: Record<string, number>;
    after: string;
  }>();
  const entries =
    library?.entries.filter((e) => e.plugin === block.plugin.uri) ?? [];
  const entry = entries.find((e) => e.id === selected);
  const locked = disabled || busy;
  async function readOrChange(kind?: 'create' | 'replace' | 'delete') {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      let command: Contract['block_settings_command'] | undefined;
      let chosen = selected;
      if (kind) {
        if (!library) return;
        const revision = library.revision;
        if (kind === 'delete') {
          if (!entry) return;
          command = { kind, revision, id: entry.id };
          chosen = '';
        } else {
          if (kind === 'replace' && !entry) return;
          chosen =
            kind === 'create'
              ? crypto.randomUUID().replaceAll('-', '')
              : entry!.id;
          command = {
            kind,
            revision,
            entry: {
              id: chosen,
              name: kind === 'create' ? name.trim() : entry!.name,
              plugin: block.plugin.uri,
              controls: namedSettingValues(block.plugin, block.controls, true),
            },
          };
        }
      }
      const next = await blockSettings(command);
      setLibrary(next);
      select(chosen);
      if (kind === 'create') setName('');
      if (kind)
        setMessage(kind === 'delete' ? 'Settings deleted.' : 'Settings saved.');
    } catch (cause) {
      setMessage(
        (cause instanceof Error
          ? cause.message
          : 'Cannot read or change block settings.') +
          ' Refresh the list before trying again.',
      );
      setLibrary(undefined);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function recall() {
    if (!entry) return;
    try {
      const values = namedSettingValues(block.plugin, entry.controls, false);
      setUndo({ before: { ...block.controls }, after: JSON.stringify(values) });
      onApply(values);
      setMessage('Settings applied to this draft.');
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : 'Cannot apply these settings.',
      );
    }
  }
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open && !library) void readOrChange();
      }}
    >
      <summary>Named settings</summary>
      <div className="control-stack">
        <label className="field">
          New settings name
          <input
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Button
          type="button"
          disabled={locked || !library || !name.trim()}
          onClick={() => void readOrChange('create')}
        >
          Save as new settings
        </Button>
        <label className="field">
          Saved settings for {block.name}
          <select
            value={entry?.id ?? ''}
            onChange={(e) => select(e.target.value)}
          >
            <option value="">Choose settings</option>
            {entries.map((e, index) => (
              <option value={e.id} key={e.id}>
                {entries.some(
                  (other) => other.id !== e.id && other.name === e.name,
                )
                  ? `${e.name} · ${index + 1}`
                  : e.name}
              </option>
            ))}
          </select>
        </label>
        <div className="action-row">
          <Button type="button" disabled={locked || !entry} onClick={recall}>
            Apply to draft
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={locked || !entry}
            onClick={() => void readOrChange('replace')}
          >
            Replace selected settings
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={locked || !entry}
            onClick={() => void readOrChange('delete')}
          >
            Delete selected settings
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={locked}
            onClick={() => void readOrChange()}
          >
            Refresh settings
          </Button>
          {undo && JSON.stringify(block.controls) === undo.after && (
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => {
                onApply(undo.before);
                setUndo(undefined);
                setMessage('Previous block settings restored.');
              }}
            >
              Undo recall
            </Button>
          )}
        </div>
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
