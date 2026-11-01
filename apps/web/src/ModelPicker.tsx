import {
  CaretRight,
  ArrowLeft,
  CloudArrowDown,
  FolderOpen,
  Play,
  MagnifyingGlass,
  Check,
} from '@phosphor-icons/react';
import { GearIcon, GearLabel } from './GearIcon';
import { useEffect, useRef, useState } from 'react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { DialogFooter } from './components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
import {
  stageTone3000,
  localModels,
  uploadLocalModel,
  stageLocalCollection,
  type LocalModelPage,
  tone3000Models,
  tone3000Tones,
  type ModelPage,
  type TonePage,
  type ToneQuery,
  toneImage,
} from './api';

/** Gear types TONE3000 can narrow a list to, per model type. */
const GEARS = {
  nam: [
    ['amp', 'Amp'],
    ['amp-cab', 'Full rig'],
    ['pedal', 'Pedal'],
    ['outboard', 'Outboard'],
    ['experimental', 'Experimental'],
  ],
  ir: [
    ['cab', 'Cab'],
    ['space', 'Space'],
  ],
} as const;
type Gear = NonNullable<ToneQuery['gear']>;

/** A tone's picture through the unit, or its gear glyph when there is none. */
function ToneThumb({ id, gear }: { id: number; gear: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="catalog-gear">
      <GearIcon gear={gear} />
    </span>
  ) : (
    <img
      className="catalog-picture"
      src={toneImage(id)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
function readView(): 'pictures' | 'list' {
  try {
    return localStorage.getItem('oxidal.picker.view') === 'list'
      ? 'list'
      : 'pictures';
  } catch {
    return 'pictures';
  }
}

/** Selection starts at the opening revision; repeat comparison advances only its own receipt. */
export function ModelPicker({
  name,
  intent = 'replace',
  initialFormat = 'nam',
  allowedFormat,
  onClose,
  onAudition,
  comparison,
}: {
  name: string;
  comparison?: {
    pending: boolean;
    appliedAsset?: string;
    error?: string | null;
    blocked?: boolean;
  };
  intent?: 'add' | 'replace' | 'download';
  initialFormat?: 'nam' | 'ir';
  allowedFormat?: 'nam' | 'ir';
  onClose: () => void;
  onAudition: (asset: string) => Promise<void>;
}) {
  const [source, setSource] = useState<'tone3000' | 'local'>('tone3000');
  const [view, setView] = useState(readView);
  function chooseView(next: 'pictures' | 'list') {
    setView(next);
    try {
      localStorage.setItem('oxidal.picker.view', next);
    } catch {
      /* optional preference */
    }
  }
  const [files, setFiles] = useState<File[]>([]);
  const [local, setLocal] = useState<LocalModelPage | null>(null);
  const [localAfter, setLocalAfter] = useState<string | null>(null);
  const [query, setQuery] = useState<ToneQuery>({
    collection: 'latest',
    page: 1,
  });
  const [format, setFormat] = useState(allowedFormat ?? initialFormat);
  const [search, setSearch] = useState('');
  const [tones, setTones] = useState<TonePage | null>(null);
  const [tone, setTone] = useState<TonePage['data'][number] | null>(null);
  const [models, setModels] = useState<ModelPage | null>(null);
  const [modelPage, setModelPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'download' | 'assign' | null>(null);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState<{
    asset: string;
    label: string;
    toneId?: number;
    modelId?: number;
  } | null>(null);
  const locked = !!busy || !!comparison?.pending || !!comparison?.blocked;
  const download = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      download.current?.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        if (source === 'local') {
          const page = await localModels(localAfter, controller.signal, true);
          if (!controller.signal.aborted) setLocal(page);
        } else if (tone) {
          const page = await tone3000Models(
            tone.id,
            modelPage,
            controller.signal,
            format,
          );
          if (!controller.signal.aborted) setModels(page);
        } else {
          const page = await tone3000Tones(query, controller.signal);
          if (!controller.signal.aborted) setTones(page);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(String(cause));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [query, tone, modelPage, format, source, localAfter]);
  function close() {
    if (busy === 'assign') return;
    download.current?.abort();
    onClose();
  }
  async function audition(id: number) {
    if (!tone || locked) return;
    const controller = new AbortController();
    download.current = controller;
    setBusy('download');
    setError('');
    try {
      const asset = await stageTone3000(tone.id, id, controller.signal);
      if (controller.signal.aborted || !alive.current) return;
      setBusy('assign');
      await onAudition(asset.id);
      if (alive.current) {
        setChoice({
          asset: asset.id,
          toneId: tone.id,
          modelId: id,
          label: models?.data.find((model) => model.id === id)?.name ?? 'Model',
        });
        if (!comparison) onClose();
      }
    } catch (cause) {
      if (!controller.signal.aborted && alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(null);
    }
  }
  async function auditionLocal(asset?: string) {
    if (locked || (!asset && files.length === 0)) return;
    const controller = new AbortController();
    download.current = controller;
    setBusy(asset ? 'assign' : 'download');
    setError('');
    try {
      if (!asset) {
        const formats = files.map((file) =>
          file.name.split('.').at(-1)?.toLowerCase(),
        );
        if (formats.some((f) => f !== 'nam' && f !== 'wav'))
          throw new Error('Choose .nam or .wav files.');
        if (new Set(formats).size !== 1)
          throw new Error(
            'Choose only NAM files or only IR files for one collection.',
          );
        const fileFormat = formats[0] === 'nam' ? 'nam' : 'ir';
        if (allowedFormat && fileFormat !== allowedFormat)
          throw new Error(
            `Choose ${allowedFormat === 'ir' ? 'IR WAV' : 'NAM'} files for this stage.`,
          );
        if (files.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024)
          throw new Error('Collection must fit within 32 MiB.');
        const ids: string[] = [];
        for (const file of files) {
          if (controller.signal.aborted || !alive.current) return;
          ids.push((await uploadLocalModel(file, controller.signal)).id);
        }
        asset =
          ids.length === 1
            ? ids[0]!
            : (await stageLocalCollection(ids, controller.signal)).id;
      }
      if (controller.signal.aborted || !alive.current) return;
      setBusy('assign');
      await onAudition(asset);
      if (alive.current) {
        setChoice({
          asset,
          label:
            (local?.data.find((model) => model.id === asset)?.title ??
              files.map((file) => file.name).join(', ')) ||
            'Local model',
        });
        if (!comparison) onClose();
      }
    } catch (cause) {
      if (!controller.signal.aborted && alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(null);
    }
  }
  const paginated =
    query.collection !== 'latest' && query.collection !== 'trending';
  const page = tone ? modelPage : (query.page ?? 1);
  const total = (tone ? models : tones)?.total_pages ?? 1;
  function turnPage(next: number) {
    if (tone) setModelPage(next);
    else setQuery({ ...query, page: next });
  }
  return (
    <AdjustmentDialog
      title={
        intent === 'download'
          ? `Get ${format === 'nam' ? 'NAM models' : 'IRs'}`
          : 'Choose model'
      }
      onCancel={close}
      className="model-picker"
    >
      <div className="control-stack">
        {intent !== 'download' && (
          <p className="truncate text-sm text-muted-foreground">
            {intent === 'add' ? 'Add to' : 'Replace'} {name}
          </p>
        )}
        {intent !== 'download' && (
          <div className="action-row" role="group" aria-label="Model source">
            <Button
              variant="ghost"
              aria-pressed={source === 'tone3000'}
              disabled={locked}
              onClick={() => setSource('tone3000')}
            >
              <CloudArrowDown aria-hidden="true" /> TONE3000
            </Button>
            <Button
              variant="ghost"
              aria-pressed={source === 'local'}
              disabled={locked}
              onClick={() => setSource('local')}
            >
              <FolderOpen aria-hidden="true" /> On this unit
            </Button>
          </div>
        )}
        {source === 'local' ? (
          <div className="space-y-3">
            <details className="local-upload">
              <summary>Add a file from this device</summary>
              <div className="space-y-3">
                <label htmlFor="local-model-file">NAM / IR file</label>
                <input
                  id="local-model-file"
                  className="w-full min-w-0"
                  type="file"
                  multiple
                  accept={
                    allowedFormat === 'nam'
                      ? '.nam'
                      : allowedFormat === 'ir'
                        ? '.wav'
                        : '.nam,.wav'
                  }
                  disabled={locked}
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
                <Button
                  variant="outline"
                  disabled={files.length === 0 || locked}
                  onClick={() => void auditionLocal()}
                >
                  {files.length > 1
                    ? `Audition ${files.length} files`
                    : 'Audition file'}
                </Button>
              </div>
            </details>
            <p className="caption">
              Everything already on this unit: models you downloaded from
              TONE3000 and files you added. No internet needed.
            </p>
            <div
              aria-label="Local model files"
              className="space-y-2"
              aria-busy={loading}
            >
              {loading ? (
                <p role="status">Reading this unit…</p>
              ) : (
                <>
                  {!local?.data.some(
                    (m) => !allowedFormat || m.format === allowedFormat,
                  ) && <p>Nothing on this unit yet.</p>}
                  {local?.data
                    .filter((m) => !allowedFormat || m.format === allowedFormat)
                    .map((m) => (
                      <Button
                        key={m.id}
                        variant="outline"
                        className="catalog-tone"
                        disabled={locked}
                        onClick={() => void auditionLocal(m.id)}
                      >
                        {m.tone_id ? (
                          <ToneThumb id={m.tone_id} gear={m.gear ?? ''} />
                        ) : (
                          <span className="catalog-gear">
                            <GearIcon
                              gear={m.gear || (m.format === 'ir' ? 'ir' : '')}
                            />
                          </span>
                        )}
                        <span className="catalog-description">
                          <strong>{m.title}</strong>
                          <span className="catalog-meta">
                            {m.gear ? <GearLabel gear={m.gear} /> : 'File'} ·{' '}
                            {m.format === 'nam' ? 'NAM' : 'IR'}
                            {m.name && m.name !== m.title ? ` · ${m.name}` : ''}
                          </span>
                        </span>
                        <span className="model-audition">
                          <Play aria-hidden="true" /> Audition
                        </span>
                      </Button>
                    ))}
                </>
              )}
            </div>
            {(localAfter || local?.next) && (
              <div className="action-row">
                <Button
                  variant="outline"
                  disabled={!localAfter || loading || locked}
                  onClick={() => setLocalAfter(null)}
                >
                  First page
                </Button>
                <Button
                  variant="outline"
                  disabled={!local?.next || loading || locked}
                  onClick={() => setLocalAfter(local!.next ?? null)}
                >
                  More files
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            {!tone ? (
              <>
                {!(intent === 'download' && allowedFormat) && (
                  <div className="action-row" aria-label="Model type">
                    {(allowedFormat
                      ? [allowedFormat]
                      : (['nam', 'ir'] as const)
                    ).map((kind) => (
                      <Button
                        key={kind}
                        variant="ghost"
                        aria-pressed={format === kind}
                        disabled={locked}
                        onClick={() => {
                          setFormat(kind);
                          setQuery({ ...query, gear: null, page: 1 });
                        }}
                      >
                        {kind === 'nam' ? 'NAM' : 'Cab / IR'}
                      </Button>
                    ))}
                  </div>
                )}
                <label className="field">
                  TONE3000 library
                  <Select
                    value={query.collection}
                    disabled={locked}
                    onValueChange={(value) => {
                      setQuery({
                        collection: value as ToneQuery['collection'],
                        page: 1,
                      });
                      setSearch('');
                    }}
                  >
                    <SelectTrigger aria-label="TONE3000 library">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="latest">Latest</SelectItem>
                      <SelectItem value="favorites">Favorites</SelectItem>
                      <SelectItem value="downloaded">Downloaded</SelectItem>
                      <SelectItem value="created">My tones</SelectItem>
                      <SelectItem value="trending">Trending</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <div className="catalog-filters">
                  <ToggleGroup
                    type="single"
                    value={query.gear ?? 'all'}
                    disabled={locked}
                    aria-label="Gear type"
                    onValueChange={(value) => {
                      if (value)
                        setQuery({
                          ...query,
                          gear: value === 'all' ? null : (value as Gear),
                          page: 1,
                        });
                    }}
                  >
                    {(
                      [[null, 'All'], ...GEARS[format]] as [
                        Gear | null,
                        string,
                      ][]
                    ).map(([gear, label]) => (
                      <ToggleGroupItem key={label} value={gear ?? 'all'}>
                        {label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <ToggleGroup
                    type="single"
                    value={view}
                    aria-label="Show tones as"
                    onValueChange={(value) => {
                      if (value === 'pictures' || value === 'list')
                        chooseView(value);
                    }}
                  >
                    {(['pictures', 'list'] as const).map((v) => (
                      <ToggleGroupItem key={v} value={v}>
                        {v === 'pictures' ? 'Pictures' : 'List'}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                {paginated && (
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setQuery({ ...query, query: search.trim(), page: 1 });
                    }}
                  >
                    <label className="field min-w-0 flex-1">
                      Search
                      <input
                        value={search}
                        maxLength={200}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <Button type="submit" variant="outline" disabled={locked}>
                      <MagnifyingGlass aria-hidden="true" /> Search
                    </Button>
                  </form>
                )}
              </>
            ) : (
              <div className="catalog-tone-header">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Back to tones"
                  disabled={locked}
                  onClick={() => {
                    setTone(null);
                    setModels(null);
                  }}
                >
                  <ArrowLeft aria-hidden="true" />
                </Button>
                <ToneThumb id={tone.id} gear={tone.gear} />
                <div className="catalog-description">
                  <strong>{tone.title}</strong>
                  <span className="catalog-meta">
                    <GearLabel gear={tone.gear} /> ·{' '}
                    {tone.user.display_name || tone.user.username} · licence{' '}
                    {tone.license.toUpperCase()}
                  </span>
                </div>
              </div>
            )}
            <div
              className="space-y-2"
              aria-label={tone ? 'Available models' : 'TONE3000 tones'}
              data-view={tone ? undefined : view}
              aria-busy={loading || locked}
            >
              {loading ? (
                <p className="catalog-empty" role="status">
                  Loading…
                </p>
              ) : tone ? (
                <>
                  {!models?.data.length && (
                    <p className="catalog-empty" role="status">
                      {format === 'nam' ? 'No A2 models' : 'No IR files'}{' '}
                      available for this tone.
                    </p>
                  )}
                  {models?.data.map((m) => {
                    const playing =
                      !comparison?.blocked &&
                      choice?.toneId === tone.id &&
                      choice.modelId === m.id &&
                      comparison?.appliedAsset === choice.asset;
                    return (
                      <Button
                        key={m.id}
                        aria-pressed={playing}
                        variant="outline"
                        className="h-auto min-h-11 w-full justify-between gap-3 py-3 text-left whitespace-normal"
                        disabled={locked}
                        onClick={() => void audition(m.id)}
                      >
                        <span className="min-w-0 break-words">
                          {m.name}
                          {m.size ? ` · ${m.size}` : ''}
                        </span>
                        <span className="model-audition">
                          {playing ? (
                            <Check aria-hidden="true" />
                          ) : intent === 'download' ? (
                            <CloudArrowDown aria-hidden="true" />
                          ) : (
                            <Play aria-hidden="true" />
                          )}{' '}
                          {playing
                            ? 'Playing'
                            : intent === 'download'
                              ? 'Download'
                              : 'Audition'}
                        </span>
                      </Button>
                    );
                  })}
                </>
              ) : (
                <>
                  {!tones?.data.some((t) => t.format === format) && (
                    <p className="catalog-empty" role="status">
                      No {format === 'nam' ? 'NAM tones' : 'IRs'} in{' '}
                      {query.collection === 'latest'
                        ? 'the latest feed'
                        : 'this collection'}
                      {query.gear ? ' with this filter' : ''}.
                      {query.collection === 'latest'
                        ? ' Latest only includes the ten newest tones. Try another collection.'
                        : ' Try another collection or gear type.'}
                    </p>
                  )}
                  {tones?.data
                    .filter((t) => t.format === format)
                    .map((t) => (
                      <Button
                        key={t.id}
                        variant="outline"
                        className="catalog-tone"
                        data-view={view}
                        onClick={() => {
                          setTone(t);
                          setModelPage(1);
                        }}
                      >
                        {view === 'pictures' ? (
                          <ToneThumb id={t.id} gear={t.gear} />
                        ) : (
                          <span className="catalog-gear">
                            <GearIcon gear={t.gear} />
                          </span>
                        )}
                        <span className="catalog-description">
                          <strong>{t.title}</strong>
                          <span>{t.user.display_name || t.user.username}</span>
                          <span className="catalog-meta">
                            <GearLabel gear={t.gear} /> · {t.models_count}{' '}
                            {t.models_count === 1 ? 'model' : 'models'}
                          </span>
                        </span>
                        <CaretRight aria-hidden="true" />
                      </Button>
                    ))}
                </>
              )}
            </div>
          </>
        )}
        <p className="caption">
          {intent === 'download'
            ? 'Downloads stay in your library for future presets. Downloading does not change the playing sound.'
            : 'Audition changes live sound; closing keeps it. Save a copy in Rig for offline use.'}
        </p>
        {comparison?.pending && (
          <p role="status">
            Preparing comparison… Close leaves this request running.
          </p>
        )}
        {choice &&
          !comparison?.blocked &&
          comparison?.appliedAsset === choice.asset && (
            <p role="status">Auditioning {choice.label}</p>
          )}
        {(comparison?.blocked || error || comparison?.error) && (
          <p role="alert">
            {comparison?.blocked
              ? 'The playing preset changed. Close and reopen the model browser.'
              : error || comparison?.error}
          </p>
        )}
        {busy && (
          <p role="status">
            {busy === 'download'
              ? source === 'local'
                ? 'Uploading for audition…'
                : intent === 'download'
                  ? 'Downloading to library…'
                  : 'Downloading for audition…'
              : intent === 'download'
                ? 'Adding to library…'
                : 'Preparing live audition…'}
          </p>
        )}
        <DialogFooter>
          {source === 'tone3000' && total > 1 && (
            <>
              <Button
                variant="outline"
                disabled={loading || locked || page <= 1}
                onClick={() => turnPage(page - 1)}
              >
                Previous
              </Button>
              <span>
                {page} / {total}
              </span>
              <Button
                variant="outline"
                disabled={loading || locked || page >= total}
                onClick={() => turnPage(page + 1)}
              >
                Next
              </Button>
            </>
          )}
          <Button
            variant="outline"
            disabled={busy === 'assign'}
            onClick={close}
          >
            {busy === 'download'
              ? source === 'local'
                ? 'Cancel upload'
                : 'Cancel download'
              : 'Close'}
          </Button>
        </DialogFooter>
      </div>
    </AdjustmentDialog>
  );
}
