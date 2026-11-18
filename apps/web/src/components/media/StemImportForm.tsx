/**
 * Import stems made elsewhere (StemDeck, a DAW) as one backing song. Files are
 * matched to roles by name and can be reassigned before the upload.
 *
 * @see docs/media.md#importing-prepared-stems
 */
import { FilePlus, Warning, X } from '@phosphor-icons/react';
import { useRef, useState } from 'react';

import './media.css';
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
import { Button } from '../ui/button';
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
      className="media-sheet stem-sheet"
      onCancel={() => {
        if (progress) return;
        roles.forEach(discard);
        onClose();
      }}
    >
      <form
        className="media-sheet-body"
        aria-label="Import stems"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="caption">
          Choose WAV or MP3 stems exported from the same song, all starting at
          the same point. Files are matched to parts by name; change any match
          below. Leave unused parts empty.
        </p>
        <div className="media-actions">
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
          <p className="media-note" role="status">
            <Warning aria-hidden="true" weight="bold" />
            <span>
              Not used, every part already has a file: {unmatched.join(', ')}
            </span>
          </p>
        )}
        <label className="stem-name">
          <span>Song name</span>
          <input
            required
            maxLength={120}
            value={title}
            disabled={!editing}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <ul className="stem-mixer" aria-label="Stem files">
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
          <div className="stem-section" role="status">
            <div
              className="stem-bar"
              role="progressbar"
              aria-label="Import progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
            >
              <i style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="caption">{progress.text}</p>
          </div>
        )}
        {error && (
          <p className="media-note" role="alert">
            <Warning aria-hidden="true" weight="bold" />
            <span>{error}</span>
          </p>
        )}
        <div className="stem-save">
          <span className="stem-save-spacer" />
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
    <li className="stem-file-row">
      <span className="stem-row-name">{label}</span>
      <span className="stem-file-name" data-empty={!file || undefined}>
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
