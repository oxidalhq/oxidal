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
} from './api';

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
  intent?: 'add' | 'replace';
  initialFormat?: 'nam' | 'ir';
  allowedFormat?: 'nam' | 'ir';
  onClose: () => void;
  onAudition: (asset: string) => Promise<void>;
}) {
  const [source, setSource] = useState<'tone3000' | 'local'>('tone3000');
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
          const page = await localModels(localAfter, controller.signal);
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
      title="Choose model"
      onCancel={close}
      className="model-picker"
    >
      <div className="space-y-3">
        <p className="truncate text-sm text-muted-foreground">
          {intent === 'add' ? 'Add to' : 'Replace'} {name}
        </p>
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
            <FolderOpen aria-hidden="true" /> Local files
          </Button>
        </div>
        {source === 'local' ? (
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
            <p className="caption">
              No sign-in needed. Save the sounding rig to keep its model and IR
              bytes offline.
            </p>
            <div
              aria-label="Local model files"
              className="space-y-2"
              aria-busy={loading}
            >
              {loading ? (
                <p role="status">Reading local files…</p>
              ) : (
                <>
                  {!local?.data.some(
                    (m) => !allowedFormat || m.format === allowedFormat,
                  ) && <p>No local files here yet.</p>}
                  {local?.data
                    .filter((m) => !allowedFormat || m.format === allowedFormat)
                    .map((m) => (
                      <Button
                        key={m.id}
                        variant="outline"
                        className="h-auto min-h-11 w-full justify-between gap-3 py-3 text-left whitespace-normal"
                        disabled={locked}
                        onClick={() => void auditionLocal(m.id)}
                      >
                        <span className="min-w-0 break-words">
                          {m.title} · {m.format === 'nam' ? 'NAM' : 'IR'}
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
                      onClick={() => setFormat(kind)}
                    >
                      {kind === 'nam' ? 'NAM' : 'Cab / IR'}
                    </Button>
                  ))}
                </div>
                <label className="field">
                  TONE3000 library
                  <select
                    value={query.collection}
                    disabled={locked}
                    onChange={(e) => {
                      setQuery({
                        collection: e.target.value as ToneQuery['collection'],
                        page: 1,
                      });
                      setSearch('');
                    }}
                  >
                    <option value="latest">Latest</option>
                    <option value="favorites">Favorites</option>
                    <option value="downloaded">Downloaded</option>
                    <option value="created">My tones</option>
                    <option value="trending">Trending</option>
                  </select>
                </label>
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
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  disabled={locked}
                  onClick={() => {
                    setTone(null);
                    setModels(null);
                  }}
                >
                  <ArrowLeft aria-hidden="true" /> Back to tones
                </Button>
                <div className="min-w-0 flex-1 break-words">
                  <strong>{tone.title}</strong>
                  <span className="block text-xs text-muted-foreground">
                    <GearLabel gear={tone.gear} /> ·{' '}
                    {tone.user.display_name || tone.user.username}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {tone.license}
                </span>
              </div>
            )}
            <div
              className="space-y-2"
              aria-label={tone ? 'Available models' : 'TONE3000 tones'}
              aria-busy={loading || locked}
            >
              {loading ? (
                <p role="status">Loading…</p>
              ) : tone ? (
                <>
                  {!models?.data.length && (
                    <p>
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
                          ) : (
                            <Play aria-hidden="true" />
                          )}{' '}
                          {playing ? 'Playing' : 'Audition'}
                        </span>
                      </Button>
                    );
                  })}
                </>
              ) : (
                <>
                  {!tones?.data.some((t) => t.format === format) && (
                    <p>
                      No {format === 'nam' ? 'NAM tones' : 'IRs'} here. Try
                      another library.
                    </p>
                  )}
                  {tones?.data
                    .filter((t) => t.format === format)
                    .map((t) => (
                      <Button
                        key={t.id}
                        variant="outline"
                        className="catalog-tone"
                        onClick={() => {
                          setTone(t);
                          setModelPage(1);
                        }}
                      >
                        <span className="catalog-gear">
                          <GearIcon gear={t.gear} />
                        </span>
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
          Audition changes live sound; closing keeps it. Save a copy in Rig for
          offline use.
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
              ? 'The playing rig changed. Close and reopen the model browser.'
              : error || comparison?.error}
          </p>
        )}
        {busy && (
          <p role="status">
            {busy === 'download'
              ? source === 'local'
                ? 'Uploading for audition…'
                : 'Downloading for audition…'
              : 'Preparing live audition…'}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
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
          <Button variant="ghost" disabled={busy === 'assign'} onClick={close}>
            {busy === 'download'
              ? source === 'local'
                ? 'Cancel upload'
                : 'Cancel download'
              : 'Close'}
          </Button>
        </div>
      </div>
    </AdjustmentDialog>
  );
}
