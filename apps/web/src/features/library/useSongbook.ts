import { useCallback, useEffect, useRef, useState } from 'react';

import type { SheetDraft } from '@oxidal/design-system/patterns/songbook';

import {
  chordSheet,
  chordSheetLinks,
  chordSheetReferences,
  chordSheets,
  deleteChordSheet,
  linkChordSheet,
  restoreChordSheets,
  saveChordSheet,
  type SheetArchive,
  type SheetDocument,
  type SheetLinks,
  type SheetPage,
  type SheetReferences,
  SheetRequestError,
} from '../../api';
import { DeviceError, friendlyError } from '../../lib/friendlyError';
import { useSessionState } from '../../lib/sessionState';
import { useWorkspaceState } from '../../workspaceMemory';
import { SHEETS_CHANGED } from './sheetResolution';

type Editor = { id: string | null; expected: string; value: SheetDraft };

/** One read owner and explicit revision-checked writes; no audio or player commands.
 * @see docs/media.md
 */
export function useSongbook(connected: boolean) {
  const [page, setPage] = useState<SheetPage>();
  const [links, setLinks] = useState<SheetLinks>();
  const [selected, setSelected] = useSessionState<string | null>(
    'songbook-selected',
    null,
  );
  const [document, setDocument] = useState<SheetDocument>();
  const [editor, setEditor] = useWorkspaceState<Editor | null>(
    'songbook-draft',
    null,
  );
  const [latest, setLatest] = useState<SheetDocument>();
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [editError, setEditError] = useState('');
  const [warning, setWarning] = useState('');
  const [damage, setDamage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<SheetReferences>();
  const reads = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!connected || !mounted.current) return;
    const read = ++reads.current;
    setLoading(true);
    try {
      // At most three pages: the device caps the complete Songbook at 128 sheets.
      let result: SheetPage | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const first = await chordSheets();
        const sheets = [...first.sheets];
        let after = first.next;
        let consistent = true;
        for (let n = 0; after && n < 2; n++) {
          const next = await chordSheets(after);
          if (next.registry_revision !== first.registry_revision) {
            consistent = false;
            break;
          }
          sheets.push(...next.sheets);
          after = next.next;
        }
        const foundLinks = await chordSheetLinks();
        if (
          consistent &&
          !after &&
          first.registry_revision === foundLinks.registry_revision
        ) {
          result = { ...first, sheets, next: undefined };
          if (read === reads.current && mounted.current) {
            setPage(result);
            setLinks(foundLinks);
            window.dispatchEvent(new Event(SHEETS_CHANGED));
            setDamage(undefined);
            setError('');
          }
          return result;
        }
      }
      throw new DeviceError(
        'Songbook changed while it was read. Refresh to see the current songs.',
        'conflict',
        409,
      );
    } catch (cause) {
      if (read === reads.current && mounted.current) {
        setError(friendlyError(cause, 'read Songbook'));
        if (cause instanceof SheetRequestError && cause.damagedSha256) {
          setDamage(cause.damagedSha256);
          setPage(undefined);
          setLinks(undefined);
        }
      }
      throw cause;
    } finally {
      if (read === reads.current && mounted.current) setLoading(false);
    }
  }, [connected]);
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => (active ? refresh() : undefined))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [refresh]);
  const selectedRevision = page?.sheets.find(
    (sheet) => sheet.id === selected,
  )?.revision;
  useEffect(() => {
    if (
      !connected ||
      !selected ||
      !selectedRevision ||
      (document?.id === selected && document.revision === selectedRevision)
    )
      return;
    let active = true;
    void chordSheet(selected).then(
      (saved) => {
        if (active) setDocument(saved);
      },
      (cause) => {
        if (active) setError(friendlyError(cause, 'read this song'));
      },
    );
    return () => {
      active = false;
    };
  }, [connected, selected, selectedRevision, document?.id, document?.revision]);
  const shown =
    document?.id === selected && document.revision === selectedRevision
      ? document
      : undefined;

  const begin = (value: SheetDraft, saved?: SheetDocument) => {
    if (!connected || !page || busy || damage) return;
    setEditor({
      id: saved?.id ?? null,
      expected: saved?.revision ?? page.registry_revision,
      value,
    });
    setLatest(undefined);
    setStale(false);
    setEditError('');
  };
  const save = async (replacement?: Editor) => {
    const draft = replacement ?? editor;
    if (!draft || !connected || busy) return;
    setBusy(true);
    setEditError('');
    try {
      const receipt = await saveChordSheet(draft.id, {
        ...draft.value,
        expected: draft.expected,
      });
      setWarning(receipt.durability_warning ?? 'Song saved on the device.');
      setSelected(receipt.sheet.id);
      setDocument(receipt.sheet);
      setEditor(null);
      setLatest(undefined);
      setStale(false);
      await refresh().catch(() => {});
    } catch (cause) {
      const conflict = cause instanceof DeviceError && cause.status === 409;
      setStale(conflict);
      if (!conflict) setEditError(friendlyError(cause, 'save this song'));
    } finally {
      setBusy(false);
    }
  };
  const reviewLatest = async () => {
    if (!editor || busy) return;
    setBusy(true);
    try {
      if (editor.id) setLatest(await chordSheet(editor.id));
      else await refresh();
    } catch (cause) {
      setEditError(friendlyError(cause, 'read the saved song'));
    } finally {
      setBusy(false);
    }
  };
  const run = async (action: () => Promise<void>) => {
    if (!connected || busy) return false;
    setBusy(true);
    setError('');
    try {
      await action();
      return true;
    } catch (cause) {
      setError(friendlyError(cause, 'change Songbook'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const previewDelete = () =>
    run(async () => {
      if (!shown) return;
      const refs = await chordSheetReferences(shown.id);
      if (refs.sheet_revision !== shown.revision) {
        setDocument(await chordSheet(shown.id));
        throw new DeviceError(
          'The song changed. Review its saved text before deleting it.',
          'conflict',
          409,
        );
      }
      setDeleting(refs);
    });
  const confirmDelete = () =>
    run(async () => {
      if (!shown || !deleting || deleting.links.length) return;
      const receipt = await deleteChordSheet(shown.id, {
        expected: deleting.sheet_revision,
        registry_revision: deleting.registry_revision,
      });
      setWarning(receipt.durability_warning ?? 'Sheet deleted on the device.');
      setDeleting(undefined);
      setSelected(null);
      setDocument(undefined);
      await refresh().catch(() => {});
    });
  const link = (
    target: SheetLinks['links'][number]['target'],
    sheet: string | null,
  ) =>
    run(async () => {
      if (!links) return;
      const receipt = await linkChordSheet({
        expected: links.registry_revision,
        target,
        sheet,
      });
      setWarning(
        receipt.durability_warning ??
          (sheet === null
            ? 'Sheet link removed.'
            : 'Sheet linked on the device.'),
      );
      setLinks(receipt);
      await refresh().catch(() => {});
      if (deleting && shown) {
        try {
          setDeleting(await chordSheetReferences(shown.id));
        } catch (cause) {
          setDeleting(undefined);
          setError(
            friendlyError(cause, 'check the remaining sheet references'),
          );
        }
      }
    });
  const restore = (
    archive: SheetArchive,
    expected: string | undefined,
    damagedSha256: string | undefined,
  ) =>
    run(async () => {
      const receipt = await restoreChordSheets({
        expected: expected ?? null,
        damaged_sha256: damagedSha256 ?? null,
        archive,
      });
      setWarning(
        receipt.durability_warning ??
          `${receipt.restored} songs restored on the device.`,
      );
      setSelected(null);
      setDocument(undefined);
      await refresh().catch(() => {});
    });
  return {
    page,
    links,
    selected,
    shown,
    editor,
    setEditor,
    latest,
    stale,
    error,
    setError,
    editError,
    warning,
    damage,
    busy,
    loading,
    refresh,
    begin,
    save,
    reviewLatest,
    previewDelete,
    deleting,
    setDeleting,
    confirmDelete,
    link,
    restore,
    open: (id: string) => {
      setSelected(id);
      setDocument(undefined);
    },
  };
}
