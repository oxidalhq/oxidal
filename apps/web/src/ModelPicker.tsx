import { useEffect, useRef, useState } from 'react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
import {
  stageTone3000,
  tone3000Models,
  tone3000Tones,
  type ModelPage,
  type TonePage,
  type ToneQuery,
} from './api';

/** Selection is tied to the opening audio revision. Closing a download never applies it. */
export function ModelPicker({
  name,
  onClose,
  onAudition,
}: {
  name: string;
  onClose: () => void;
  onAudition: (asset: string) => Promise<void>;
}) {
  const [query, setQuery] = useState<ToneQuery>({
    collection: 'latest',
    page: 1,
  });
  const [search, setSearch] = useState('');
  const [tones, setTones] = useState<TonePage | null>(null);
  const [tone, setTone] = useState<TonePage['data'][number] | null>(null);
  const [models, setModels] = useState<ModelPage | null>(null);
  const [modelPage, setModelPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'download' | 'assign' | null>(null);
  const [error, setError] = useState('');
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
        if (tone) {
          const page = await tone3000Models(
            tone.id,
            modelPage,
            controller.signal,
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
  }, [query, tone, modelPage]);
  function close() {
    if (busy === 'assign') return;
    download.current?.abort();
    onClose();
  }
  async function audition(id: number) {
    if (!tone || busy) return;
    const controller = new AbortController();
    download.current = controller;
    setBusy('download');
    setError('');
    try {
      const asset = await stageTone3000(tone.id, id, controller.signal);
      if (controller.signal.aborted || !alive.current) return;
      setBusy('assign');
      await onAudition(asset.id);
      if (alive.current) onClose();
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
    <AdjustmentDialog title="Choose NAM" onCancel={close}>
      <div className="space-y-3">
        <p className="truncate text-sm text-muted-foreground">Replace {name}</p>
        {!tone ? (
          <>
            <label className="field">
              TONE3000 library
              <select
                value={query.collection}
                disabled={!!busy}
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
                <Button type="submit" disabled={!!busy}>
                  Search
                </Button>
              </form>
            )}
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => {
                setTone(null);
                setModels(null);
              }}
            >
              Back to tones
            </Button>
            <strong className="min-w-0 break-words">{tone.title}</strong>
            <span className="text-xs text-muted-foreground">
              {tone.license}
            </span>
          </div>
        )}
        <div
          className="space-y-2"
          aria-label={tone ? 'NAM models' : 'TONE3000 tones'}
          aria-busy={loading || !!busy}
        >
          {loading ? (
            <p role="status">Loading…</p>
          ) : tone ? (
            <>
              {!models?.data.length && (
                <p>No A2 models available for this tone.</p>
              )}
              {models?.data.map((m) => (
                <Button
                  key={m.id}
                  variant="outline"
                  className="h-auto min-h-11 w-full justify-between gap-3 py-3 text-left whitespace-normal"
                  disabled={!!busy}
                  onClick={() => void audition(m.id)}
                >
                  <span className="min-w-0 break-words">
                    {m.name}
                    {m.size ? ` · ${m.size}` : ''}
                  </span>
                  <span>Audition</span>
                </Button>
              ))}
            </>
          ) : (
            <>
              {!tones?.data.some((t) => t.format === 'nam') && (
                <p>No NAM tones here. Try another library.</p>
              )}
              {tones?.data
                .filter((t) => t.format === 'nam')
                .map((t) => (
                  <Button
                    key={t.id}
                    variant="outline"
                    className="h-auto min-h-11 w-full flex-col items-start gap-1 py-3 text-left whitespace-normal"
                    onClick={() => {
                      setTone(t);
                      setModelPage(1);
                    }}
                  >
                    <strong className="break-words">{t.title}</strong>
                    <span className="text-xs text-muted-foreground">
                      {t.user.display_name || t.user.username} · {t.gear}
                    </span>
                  </Button>
                ))}
            </>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        {busy && (
          <p role="status">
            {busy === 'download'
              ? 'Downloading for audition…'
              : 'Preparing live audition…'}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {total > 1 && (
            <>
              <Button
                variant="outline"
                disabled={loading || !!busy || page <= 1}
                onClick={() => turnPage(page - 1)}
              >
                Previous
              </Button>
              <span>
                {page} / {total}
              </span>
              <Button
                variant="outline"
                disabled={loading || !!busy || page >= total}
                onClick={() => turnPage(page + 1)}
              >
                Next
              </Button>
            </>
          )}
          <Button variant="ghost" disabled={busy === 'assign'} onClick={close}>
            {busy === 'download' ? 'Cancel download' : 'Close'}
          </Button>
        </div>
      </div>
    </AdjustmentDialog>
  );
}
