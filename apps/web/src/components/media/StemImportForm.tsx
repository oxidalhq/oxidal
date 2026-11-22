/**
 * Import stems made elsewhere (StemDeck, a DAW) as one backing song. Files are
 * matched to roles by name and can be reassigned before the upload.
 *
 * @see docs/media.md#importing-prepared-stems
 */
import { FilePlus, Warning, X } from '@phosphor-icons/react';
import { useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Progress } from '@oxidal/design-system/components/states';
import { Caption } from '@oxidal/design-system/components/text';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import {
  cancelUpload,
  importSongStems,
  type MediaAsset,
  OffsetConflict,
  sendChunk,
  type SongImportStems,
  startUpload,
} from '../../api';
import { deviceSentence } from '../../lib/friendlyError';
import { CHUNK_BYTES } from '../../lib/mediaUpload';
import { fileSize } from './sessionMedia';
import { guessRole, ROLE_ORDER, roleLabel } from './stemMix';

type Role = SongImportStems['stems'][number]['role'];
const roles = ROLE_ORDER as Role[];
const ACCEPT = '.wav,.wave,.mp3,audio/wav,audio/x-wav,audio/mpeg';

/** "Song - vocals.wav" and "Song_drums.mp3" share the title "Song". */
function guessTitle(files: File[]): string {
  const names = files.map((file) =>
    file.name
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(
        /[\s._-]*(vocals?|vox|drums?|bass|guitars?|gtr|piano|keys|other|instrumental)[\s._-]*$/i,
        '',
      )
      .trim(),
  );
  const first = names[0] ?? '';
  return names.every((name) => name === first) ? first.slice(0, 120) : '';
}

export function StemImportForm({
  locked,
  onClose,
  onImported,
}: {
  locked: boolean;
  onClose: () => void;
  onImported: (asset: MediaAsset) => void;
}) {
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState<Partial<Record<Role, File>>>({});
  const [progress, setProgress] = useState<{ text: string; percent: number }>();
  const [error, setError] = useState('');
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const uploads = useRef(new Map<Role, { id: string; offset: number }>());
  const picker = useRef<HTMLInputElement>(null);
  const chosen = roles.filter((role) => files[role]);

  function discard(role: Role) {
    const pending = uploads.current.get(role);
    if (pending) void cancelUpload(pending.id).catch(() => {});
    uploads.current.delete(role);
  }

  function assign(role: Role, file: File | undefined) {
    discard(role);
    setFiles((current) => ({ ...current, [role]: file }));
  }

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const added = [...list];
    const next = { ...files };
    const missed: string[] = [];
    for (const file of added) {
      const role =
        guessRole(file.name) ?? roles.find((candidate) => !next[candidate]);
      if (role && !next[role]) {
        discard(role);
        next[role] = file;
      } else missed.push(file.name);
    }
    setFiles(next);
    setUnmatched(missed);
    if (!title) setTitle(guessTitle(added));
  }

  async function submit() {
    if (locked || progress || !title.trim() || !chosen.length) return;
    setError('');
    const total = chosen.reduce(
      (sum, role) => sum + (files[role]?.size ?? 0),
      0,
    );
    let sent = 0;
    try {
      const stems: SongImportStems['stems'] = [];
      for (const role of chosen) {
        const file = files[role];
        if (!file) continue;
        let upload = uploads.current.get(role);
        if (!upload) {
          const created = await startUpload(file.name, file.size, true);
          upload = { id: created.id, offset: created.offset };
          uploads.current.set(role, upload);
        }
        while (upload.offset < file.size) {
          setProgress({
            text: `Uploading ${roleLabel(role).toLowerCase()}…`,
            percent: Math.round(((sent + upload.offset) / total) * 90),
          });
          try {
            const state = await sendChunk(
              upload.id,
              upload.offset,
              file.slice(upload.offset, upload.offset + CHUNK_BYTES),
            );
            upload.offset = state.offset;
          } catch (cause) {
            if (!(cause instanceof OffsetConflict)) throw cause;
            upload.offset = cause.state.offset;
          }
        }
        sent += file.size;
        stems.push({ role, upload: upload.id });
      }
      setProgress({
        text: 'Lining up the stems and preparing playback…',
        percent: 95,
      });
      onImported(await importSongStems({ title: title.trim(), stems }));
      uploads.current.clear();
    } catch (cause) {
      setError(deviceSentence(cause, 'import the stems'));
    } finally {
      setProgress(undefined);
    }
  }

  const editing = !locked && !progress;
  return (
    <AdjustmentDialog
      title="Import stems"
      description="One song from separate stem files"
      sideSheet
      className="lg:w-[min(42rem,100vw)]"
      onCancel={() => {
        if (progress) return;
        roles.forEach(discard);
        onClose();
      }}
    >
      <form
        className="grid min-w-0 content-start gap-3"
        aria-label="Import stems"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Caption>
          Choose WAV or MP3 stems exported from the same song, all starting at
          the same point. Files are matched to parts by name; change any match
          below. Leave unused parts empty.
        </Caption>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!editing}
            onClick={() => picker.current?.click()}
          >
            <FilePlus aria-hidden="true" />
            Choose stem files…
          </Button>
          <input
            ref={picker}
            type="file"
            hidden
            multiple
            accept={ACCEPT}
            aria-label="Choose stem files"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
        {!!unmatched.length && (
          <p
            className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
            role="status"
          >
            <Warning aria-hidden="true" weight="bold" />
            <span>
              Not used, every part already has a file: {unmatched.join(', ')}
            </span>
          </p>
        )}
        <label className="grid min-w-0 gap-1 text-sm font-medium [&>input]:min-h-touch [&>input]:min-w-0 [&>input]:rounded-md [&>input]:border [&>input]:border-input [&>input]:bg-background [&>input]:px-2">
          <span>Song name</span>
          <input
            required
            maxLength={120}
            value={title}
            disabled={!editing}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <ul className="grid min-w-0 gap-3" aria-label="Stem files">
          {roles.map((role) => (
            <StemFileRow
              key={role}
              role={role}
              file={files[role]}
              disabled={!editing}
              onChoose={(file) => assign(role, file)}
            />
          ))}
        </ul>
        {progress && (
          <div
            className="grid min-w-0 gap-2 border-t border-border pt-3 first:border-0 first:pt-0"
            role="status"
          >
            <Progress label="Import progress" value={progress.percent} />
            <Caption>{progress.text}</Caption>
          </div>
        )}
        {error && (
          <p
            className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
            role="alert"
          >
            <Warning aria-hidden="true" weight="bold" />
            <span>{error}</span>
          </p>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="flex-1" />
          <Button
            type="button"
            variant="outline"
            disabled={!!progress}
            onClick={() => {
              roles.forEach(discard);
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button disabled={!editing || !title.trim() || !chosen.length}>
            Import {chosen.length || ''}{' '}
            {chosen.length === 1 ? 'stem' : 'stems'}
          </Button>
        </div>
      </form>
    </AdjustmentDialog>
  );
}

function StemFileRow({
  role,
  file,
  disabled,
  onChoose,
}: {
  role: Role;
  file: File | undefined;
  disabled: boolean;
  onChoose: (file: File | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const label = roleLabel(role);
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border py-2">
      <span className="min-w-0 text-sm font-semibold break-words">{label}</span>
      <span
        className="min-w-0 truncate text-xs data-[empty]:text-muted-foreground"
        data-empty={!file || undefined}
      >
        {file ? `${file.name} · ${fileSize(file.size)}` : 'No file'}
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-label={`Choose ${label} file`}
        onClick={() => input.current?.click()}
      >
        {file ? 'Change' : 'Choose'}
      </Button>
      {file && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={`Remove ${label} file`}
          onClick={() => onChoose(undefined)}
        >
          <X aria-hidden="true" />
        </Button>
      )}
      <input
        ref={input}
        type="file"
        hidden
        accept={ACCEPT}
        aria-label={`${label} file`}
        onChange={(event) => {
          onChoose(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </li>
  );
}
