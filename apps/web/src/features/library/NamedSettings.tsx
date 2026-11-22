import { useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  ActionRow,
  FormField,
} from '@oxidal/design-system/components/form-layout';

import { blockSettings } from '../../api';
import type { Contract } from '../../generated/contract';
import type { DraftEffect } from '../../rigDraft';
import { namedSettingValues } from './namedSettingValues';

export function NamedSettings({
  block,
  disabled,
  live = false,
  onApply,
}: {
  block: Pick<
    Extract<DraftEffect, { kind: 'lv2' }>,
    'plugin' | 'name' | 'controls'
  >;
  live?: boolean;
  disabled: boolean;
  onApply: (
    values: Record<string, number>,
  ) => void | Promise<boolean | undefined>;
}) {
  const [library, setLibrary] = useState<Contract['block_settings']>();
  const [name, setName] = useState('');
  const [selected, select] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState('');
  const [undo, setUndo] = useState<{
    before: Record<string, number>;
    after: Record<string, number>;
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
              controls: namedSettingValues(block.plugin, block.controls, !live),
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
  async function recall(restore = false) {
    if (pending.current || disabled || (restore ? !undo : !entry)) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      const values = restore
        ? undo!.before
        : namedSettingValues(block.plugin, entry!.controls, false);
      const before = { ...block.controls };
      const result = onApply(values);
      if (result && !(await result))
        throw new Error(
          'The device did not confirm the block settings. Check the current values.',
        );
      setUndo(restore ? undefined : { before, after: values });
      setMessage(
        restore
          ? 'Previous block settings restored.'
          : live
            ? 'Settings applied to the playing block.'
            : 'Settings applied to this draft.',
      );
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : 'Cannot apply these settings.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open && !library) void readOrChange();
      }}
    >
      <summary>Named settings</summary>
      <div className="grid min-w-0 items-start gap-3 [&>button]:max-w-full [&>button]:justify-self-start">
        <FormField>
          New settings name
          <input
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <Button
          type="button"
          disabled={locked || !library || !name.trim()}
          onClick={() => void readOrChange('create')}
        >
          Save as new settings
        </Button>
        <FormField>
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
        </FormField>
        <ActionRow>
          <Button
            type="button"
            disabled={locked || !entry}
            onClick={() => void recall()}
          >
            {live ? 'Apply to playing block' : 'Apply to draft'}
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
          {undo &&
            Object.keys(undo.after).length ===
              Object.keys(block.controls).length &&
            Object.entries(undo.after).every(
              ([symbol, value]) => block.controls[symbol] === value,
            ) && (
              <Button
                type="button"
                variant="outline"
                disabled={locked}
                onClick={() => void recall(true)}
              >
                Undo recall
              </Button>
            )}
        </ActionRow>
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
