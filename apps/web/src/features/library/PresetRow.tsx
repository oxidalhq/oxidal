import { MusicNotes, Play } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  type LibraryBadge,
  type LibraryItem,
  LibraryRow,
} from '@oxidal/design-system/patterns/library-list';

import { type RowAction, RowMenu } from '../../components/RowMenu';

/** The picture a preset row and its details panel share. */
export function PresetTile() {
  return (
    <span className="grid size-11 place-items-center rounded-md border border-border bg-background text-muted-foreground">
      <MusicNotes aria-hidden="true" className="size-5" />
    </span>
  );
}

/**
 * One preset row everywhere in Library (7.2): the name and a one-line summary,
 * the chain strip and status chips (Playing, Unsaved, Ready, In set list), a
 * distinct Play button and a menu for occasional actions. The row's blank
 * area never changes audio: it opens the details, or, beside a details
 * panel, shows this preset in it.
 * @see docs/interface.md
 */
export function PresetRow({
  name,
  meta,
  playing = false,
  loading = false,
  disabled = false,
  onPlay,
  onDetails,
  actions = [],
  extra,
  favourite,
  chain,
  badges = [],
  selected,
  hideMenu = false,
  testId,
}: {
  name: string;
  meta: string;
  playing?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPlay?: () => void;
  onDetails?: () => void;
  actions?: RowAction[];
  extra?: ReactNode;
  favourite?: ReactNode;
  /** The preset's blocks, drawn as a small strip under its name. */
  chain?: LibraryItem['chain'];
  /** Status chips after Playing: Unsaved, Ready, In set list #2. */
  badges?: LibraryBadge[];
  /** Shown in the details panel beside the list (wide screens). */
  selected?: boolean;
  /** The details panel carries the menu's actions, so the row leaves it out. */
  hideMenu?: boolean;
  testId?: string;
}) {
  return (
    <LibraryRow
      item={{
        id: name,
        title: name,
        caption: meta,
        chain,
        badge:
          playing || loading
            ? { text: loading ? 'Starting…' : 'Playing', tone: 'live' }
            : undefined,
        badges,
      }}
      active={selected ?? playing}
      testId={testId}
      onOpen={onDetails}
      openPrefix={onDetails ? 'Details:' : undefined}
      leading={<PresetTile />}
      actions={
        <>
          {extra}
          {favourite}
          {onPlay && (
            <Button
              size="sm"
              variant={playing ? 'default' : 'outline'}
              disabled={disabled || loading}
              aria-pressed={playing}
              aria-label={`${playing ? 'Playing' : 'Play'} ${name}`}
              onClick={onPlay}
            >
              <Play aria-hidden="true" />{' '}
              <span className="max-sm:sr-only">
                {playing ? 'Playing' : 'Play'}
              </span>
            </Button>
          )}
          {actions.length > 0 && !hideMenu && (
            <RowMenu name={name} items={actions} />
          )}
        </>
      }
    />
  );
}
