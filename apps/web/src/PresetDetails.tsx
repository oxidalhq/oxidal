import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { Badge } from '@oxidal/design-system/components/badge';
import { Button } from '@oxidal/design-system/components/button';
import { FormField } from '@oxidal/design-system/components/form-layout';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
} from '@oxidal/design-system/components/sheet';
import { Loading } from '@oxidal/design-system/components/states';
import { Caption, Eyebrow } from '@oxidal/design-system/components/text';
import { SettingNotice } from '@oxidal/design-system/patterns/settings-page';

import {
  type DetailsCatalog,
  type LibraryCatalog,
  type PresetDetails,
  presetDetails,
  type VersionSelection,
} from './api';
import {
  type PresetFileFacts,
  presetFileSummary,
  usePresetArtwork,
} from './features/library/presetFile';
import { PresetFileSources } from './features/library/PresetFileSources';
import { PresetVersions } from './features/library/PresetVersions';
import { friendlyError } from './lib/friendlyError';
import { detailsKey } from './presetMetadata';

type Entry = Pick<LibraryCatalog['items'][number], 'kind' | 'id' | 'name'>;
const emptyDetails: PresetDetails = {
  description: '',
  categories: [],
  copied_from: null,
};
/** Opening details reads metadata only; it never recalls a preset or starts audio. */
export function PresetDetailsDialog({
  entry,
  onCancel,
  onChanged,
  onEditVersion,
  editable = false,
  file,
  children,
}: {
  entry: Entry;
  /** What a TONE3000 preset file says about itself: its blocks and models. */
  file?: PresetFileFacts;
  onCancel: () => void;
  onChanged?: () => void;
  onEditVersion?: (selection: VersionSelection) => void;
  editable?: boolean;
  /** Extra actions for this preset, such as Manage on the playing preset. */
  children?: ReactNode;
}) {
  const [catalog, setCatalog] = useState<DetailsCatalog | null>(null);
  const [details, setDetails] = useState<PresetDetails>(emptyDetails);
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const identity = detailsKey(entry);
  // A TONE3000 preset file carries its own captures: show them, and fetch
  // the pictures a fresh install does not have.
  const tone3000 = entry.kind === 'original' || entry.kind === 'owned';
  const owned = entry.kind === 'owned';
  const artwork = usePresetArtwork(tone3000 ? entry.id : null, owned);
  const captures = artwork.items?.filter((item) => item.key).length;
  useEffect(() => {
    let active = true;
    void presetDetails()
      .then((c) => {
        if (!active) return;
        const d =
          c.entries.find((e) => detailsKey(e.entry) === identity)?.details ??
          emptyDetails;
        setCatalog(c);
        setDetails(d);
        setDescription(d.description);
        setCategories(d.categories.join(', '));
        setEditing(false);
      })
      .catch((e: unknown) => {
        if (active) setError(friendlyError(e, 'read the preset details'));
      });
    return () => {
      active = false;
    };
  }, [identity, refresh]);
  async function save() {
    if (!catalog || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await presetDetails({
        expected_revision: catalog.revision,
        entry_kind: entry.kind,
        id: entry.id,
        description,
        categories: categories
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      });
      const d =
        result.entries.find((e) => detailsKey(e.entry) === identity)?.details ??
        emptyDetails;
      setCatalog(result);
      setDetails(d);
      setEditing(false);
      onChanged?.();
    } catch (e) {
      setError(friendlyError(e, 'update the preset details'));
      setCatalog(null);
    } finally {
      setBusy(false);
    }
  }
  const close = (open: boolean) => {
    if (!open && !busy) onCancel();
  };
  return (
    // A side panel named after the preset, as Storybook's Presets pattern
    // draws it: labelled sections, the actions along the bottom.
    <Sheet open onOpenChange={close}>
      <SheetContent onOpenChange={close} className="md:w-[min(28rem,100vw)]">
        <SheetHeader
          title={entry.name}
          description={
            tone3000
              ? presetFileSummary(owned, file, captures)
              : 'Preset details'
          }
        />
        <SheetBody className="grid min-w-0 content-start gap-5">
          {error && (
            <SettingNotice
              tone="error"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCatalog(null);
                    setError('');
                    setRefresh((v) => v + 1);
                  }}
                >
                  Reload saved details
                </Button>
              }
            >
              {error}
            </SettingNotice>
          )}
          {!catalog && !error && <Loading label="Loading details…" />}
          {editing ? (
            <form
              id="preset-details-form"
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <FormField>
                Description
                <textarea
                  className="min-h-32 w-full resize-y rounded-md border border-input bg-card p-3"
                  maxLength={4000}
                  value={description}
                  disabled={busy}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </FormField>
              <FormField>
                Categories
                <input
                  value={categories}
                  disabled={busy}
                  maxLength={800}
                  onChange={(e) => setCategories(e.target.value)}
                  placeholder="Clean, Ambient, Lead"
                />
              </FormField>
              <Caption className="text-xs">
                Separate categories with commas. Up to 16 categories, 48
                characters each.
              </Caption>
            </form>
          ) : (
            catalog && (
              <>
                {/* As Storybook's Presets pattern orders it: versions, then
                    the captures the preset holds, then your own notes. */}
                <section className="grid gap-1">
                  <Eyebrow>Versions</Eyebrow>
                  <PresetVersions
                    key={identity}
                    kind={entry.kind}
                    id={entry.id}
                    editable={editable && entry.kind !== 'original'}
                    onEdit={onEditVersion}
                    onChanged={onChanged}
                  />
                </section>
                {tone3000 && (
                  <PresetFileSources
                    id={entry.id}
                    owned={owned}
                    facts={file}
                    artwork={artwork}
                  />
                )}
                <section className="grid gap-1">
                  <Eyebrow>Description</Eyebrow>
                  {details.description ? (
                    <p className="m-0 text-sm wrap-anywhere whitespace-pre-wrap">
                      {details.description}
                    </p>
                  ) : (
                    <Caption>No description yet.</Caption>
                  )}
                </section>
                <section className="grid gap-1.5">
                  <Eyebrow>Categories</Eyebrow>
                  {details.categories.length ? (
                    <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
                      {details.categories.map((c) => (
                        <li key={c}>
                          <Badge size="sm" className="wrap-anywhere">
                            {c}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Caption>No categories yet.</Caption>
                  )}
                </section>
                {details.copied_from && (
                  <section className="grid gap-1">
                    <Eyebrow>Copied from</Eyebrow>
                    <Caption className="wrap-anywhere">
                      {details.copied_from.name}
                    </Caption>
                  </section>
                )}
              </>
            )
          )}
        </SheetBody>
        {(editing || (editable && catalog) || children) && (
          <SheetFooter className="flex-wrap">
            {editing ? (
              <>
                {/* Distinct keys and a plain button: React must not turn the
                    pressed Edit details into a submit button mid-click, or
                    the browser would save the unchanged details at once. */}
                <Button
                  key="save"
                  disabled={busy || !catalog}
                  onClick={() => void save()}
                >
                  {busy ? 'Saving…' : 'Save details'}
                </Button>
                <Button
                  key="cancel"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setDescription(details.description);
                    setCategories(details.categories.join(', '));
                    setEditing(false);
                  }}
                >
                  Cancel edit
                </Button>
              </>
            ) : (
              <>
                {editable && catalog && (
                  <Button
                    key="edit"
                    variant="outline"
                    onClick={() => setEditing(true)}
                  >
                    Edit details
                  </Button>
                )}
                {children}
              </>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
