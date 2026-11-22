import { MusicNotes, Play } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { LibraryRow } from '@oxidal/design-system/patterns/library-list';

import { type RowAction,RowMenu } from '../../components/RowMenu';

/**
 * One preset row everywhere in Library (7.2): the name and a one-line summary,
 * a distinct Play button, Details, and a menu for occasional actions. The
 * row's blank area never changes audio.
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
  testId?: string;
}) {
  return (
    <LibraryRow
      item={{
        id: name,
        title: name,
        caption: meta,
        badge:
          playing || loading
            ? { text: loading ? 'Starting…' : 'Playing', tone: 'live' }
            : undefined,
      }}
      active={playing}
      testId={testId}
      onOpen={onDetails}
      openPrefix={onDetails ? 'Details:' : undefined}
      leading={
        <span className="grid size-11 place-items-center rounded-md border border-border bg-background text-muted-foreground">
          <MusicNotes aria-hidden="true" className="size-5" />
        </span>
      }
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
          {actions.length > 0 && <RowMenu name={name} items={actions} />}
        </>
      }
    />
  );
}
