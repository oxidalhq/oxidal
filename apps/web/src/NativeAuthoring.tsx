import { NativeTools } from './NativeTools';
import { useEffect, useRef, useState } from 'react';
import { tone3000Tone, type AudioState, type AudioAction } from './api';
import { Button } from './components/ui/button';
import { AdjustmentDialog } from './AdjustmentDialog';
import { TouchAdjust } from './TouchAdjust';
export function NativeAuthoring({
  status,
  selectedBlock,
  disabled,
  busy,
  session,
  revision,
  author,
}: {
  status: NonNullable<AudioState['authoring']>;
  selectedBlock?: string;
  disabled: boolean;
  busy: boolean;
  session: string;
  revision: number;
  author: (
    action: Extract<AudioAction, { kind: 'authoring' }>['action'],
  ) => Promise<void>;
}) {
  const [settingDraft, setSettingDraft] = useState<{
    control: AudioState['controls'][number];
    value: number;
    session: string;
    revision: number;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [metadataError, setMetadataError] = useState('');
  const metadataRequest = useRef<AbortController | null>(null);
  const metadataCursor = useRef({ session, revision, selectedBlock });
  useEffect(() => {
    metadataCursor.current = { session, revision, selectedBlock };
  }, [session, revision, selectedBlock]);
  useEffect(
    () => () => {
      metadataRequest.current?.abort();
    },
    [session, selectedBlock],
  );
  const spectrumOwner = useRef({
    author,
    block: status.tools?.spectrum?.block_id,
  });
  useEffect(() => {
    spectrumOwner.current = { author, block: status.tools?.spectrum?.block_id };
  }, [author, status.tools?.spectrum?.block_id]);
  useEffect(
    () => () => {
      const owner = spectrumOwner.current;
      if (selectedBlock && owner.block === selectedBlock)
        void owner.author({
          kind: 'spectrum',
          block_id: selectedBlock,
          enabled: false,
        });
    },
    [selectedBlock],
  );
  const layout = status.layout;
  const editingDisabled =
    disabled ||
    status.tools?.balance.state === 'listening' ||
    status.tools?.alignment.state === 'listening';
  const lane = layout?.right.some((b) => b.id === selectedBlock)
    ? 'right'
    : 'left';
  const laneBlocks = layout?.[lane] ?? [];
  const position = laneBlocks.findIndex(
    (b) => b.id === selectedBlock && !b.insert,
  );
  function reorder(direction: number) {
    const next = position + direction;
    if (position < 0 || next < 0 || next >= laneBlocks.length) return;
    const ids = laneBlocks.map((b) => b.id);
    [ids[position], ids[next]] = [ids[next]!, ids[position]!];
    void author({
      kind: 'edit',
      edit: { kind: 'reorder', lane, block_ids: ids },
    });
  }
  return (
    <>
      <NativeTools status={status} disabled={disabled} author={author} />
      {selectedBlock && position >= 0 && laneBlocks[position]?.tone_id && (
        <div className="space-y-2">
          <Button
            variant="outline"
            disabled={editingDisabled || refreshing}
            onClick={async () => {
              const opening = metadataCursor.current;
              const abort = new AbortController();
              metadataRequest.current = abort;
              setRefreshing(true);
              setMetadataError('');
              try {
                const tone = await tone3000Tone(
                  laneBlocks[position]!.tone_id!,
                  abort.signal,
                );
                const now = metadataCursor.current;
                if (abort.signal.aborted) return;
                if (
                  now.session !== opening.session ||
                  now.revision !== opening.revision ||
                  now.selectedBlock !== opening.selectedBlock
                )
                  throw new Error(
                    'Tone changed while fetching details. Refresh again.',
                  );
                await author({
                  kind: 'refresh_metadata',
                  block_id: selectedBlock,
                  tone,
                });
              } catch (error) {
                if (!abort.signal.aborted) setMetadataError(String(error));
              } finally {
                setRefreshing(false);
              }
            }}
          >
            {refreshing ? 'Refreshing details…' : 'Refresh tone details'}
          </Button>
          {metadataError && <p role="alert">{metadataError}</p>}
        </div>
      )}
      {selectedBlock && position >= 0 && (
        <details
          onToggle={(event) => {
            if (
              !event.currentTarget.open &&
              status.tools?.spectrum?.block_id === selectedBlock
            )
              void author({
                kind: 'spectrum',
                block_id: selectedBlock,
                enabled: false,
              });
          }}
        >
          <summary>Block spectrum</summary>
          <Button
            variant="outline"
            disabled={editingDisabled}
            aria-pressed={status.tools?.spectrum?.block_id === selectedBlock}
            onClick={() =>
              void author({
                kind: 'spectrum',
                block_id: selectedBlock,
                enabled: status.tools?.spectrum?.block_id !== selectedBlock,
              })
            }
          >
            {status.tools?.spectrum?.block_id === selectedBlock
              ? 'Stop analysis'
              : 'Analyze selected block'}
          </Button>
          {status.tools?.spectrum?.block_id === selectedBlock && (
            <div className="space-y-1 py-2">
              <svg
                role="img"
                aria-label="Post-EQ spectrum, 20 Hz to 20 kHz, minus 100 to zero dB"
                viewBox="0 0 256 100"
                className="h-24 w-full text-primary"
                preserveAspectRatio="none"
              >
                {status.tools?.spectrum.bins.map((db, i) => (
                  <rect
                    key={i}
                    x={i * 4}
                    y={-db}
                    width={3}
                    height={100 + db}
                    fill="currentColor"
                  />
                ))}
              </svg>
              <div className="flex justify-between font-mono text-xs">
                <span>20 Hz</span>
                <span>Post-EQ · dBFS</span>
                <span>20 kHz</span>
              </div>
            </div>
          )}
        </details>
      )}
      {position >= 0 && (laneBlocks[position]?.variants?.length ?? 0) > 1 && (
        <label className="space-y-2">
          <span>Model variant</span>
          <select
            aria-label="Model variant"
            disabled={editingDisabled}
            value={laneBlocks[position]?.active_model ?? ''}
            onChange={(event) =>
              void author({
                kind: 'select_model',
                block_id: selectedBlock!,
                model_id: Number(event.target.value),
              })
            }
          >
            {laneBlocks[position]!.variants!.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {layout && (
        <details>
          <summary>Chain actions</summary>
          {status.history_error && (
            <p role="status" className="caption" title={status.history_error}>
              Undo history unavailable
            </p>
          )}
          <div
            className="action-row"
            role="group"
            aria-label="Live chain actions"
          >
            <Button
              variant="outline"
              disabled={editingDisabled || !status?.can_undo}
              onClick={() => void author({ kind: 'undo' })}
            >
              Undo change
            </Button>
            <Button
              variant="outline"
              disabled={editingDisabled || !status?.can_redo}
              onClick={() => void author({ kind: 'redo' })}
            >
              Redo change
            </Button>
            <Button
              variant="outline"
              disabled={editingDisabled}
              onClick={() =>
                void author({
                  kind: 'edit',
                  edit: { kind: 'stereo', enabled: !layout.stereo },
                })
              }
            >
              {layout.stereo ? 'Use mono chain' : 'Use stereo chains'}
            </Button>
            <Button
              variant="outline"
              disabled={editingDisabled || !layout.stereo}
              onClick={() =>
                void author({ kind: 'edit', edit: { kind: 'swap' } })
              }
            >
              Swap left/right
            </Button>
            <Button
              variant="outline"
              disabled={editingDisabled}
              onClick={() =>
                void author({ kind: 'edit', edit: { kind: 'reset' } })
              }
            >
              Reset chain
            </Button>
            <Button
              variant="outline"
              disabled={editingDisabled || !status.can_paste}
              onClick={() =>
                void author({
                  kind: 'edit',
                  edit: {
                    kind: 'paste',
                    lane,
                    index: position >= 0 ? position + 1 : laneBlocks.length,
                  },
                })
              }
            >
              Paste block
            </Button>
            {(['stereo', 'left', 'right', 'dual'] as const).map((mode) => (
              <Button
                key={mode}
                variant="outline"
                disabled={editingDisabled}
                aria-pressed={(layout.input_mode ?? 'stereo') === mode}
                onClick={() =>
                  void author({ kind: 'edit', edit: { kind: 'input', mode } })
                }
              >
                {mode === 'dual'
                  ? 'Dual mono'
                  : `${mode.charAt(0).toUpperCase()}${mode.slice(1)} input`}
              </Button>
            ))}
            {selectedBlock && position >= 0 && (
              <>
                <Button
                  variant="outline"
                  disabled={editingDisabled}
                  onClick={() =>
                    void author({ kind: 'copy', block_id: selectedBlock })
                  }
                >
                  Copy block
                </Button>

                <Button
                  variant="outline"
                  disabled={editingDisabled || position === 0}
                  onClick={() => reorder(-1)}
                >
                  Earlier
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    editingDisabled || position === laneBlocks.length - 1
                  }
                  onClick={() => reorder(1)}
                >
                  Later
                </Button>
                <Button
                  variant="outline"
                  disabled={editingDisabled}
                  onClick={() =>
                    void author({
                      kind: 'edit',
                      edit: {
                        kind: 'duplicate',
                        block_id: selectedBlock,
                        lane,
                        index: position + 1,
                      },
                    })
                  }
                >
                  Duplicate block
                </Button>
                {layout.stereo && (
                  <Button
                    variant="outline"
                    disabled={editingDisabled}
                    onClick={() =>
                      void author({
                        kind: 'edit',
                        edit: {
                          kind: 'move',
                          block_id: selectedBlock,
                          lane: lane === 'left' ? 'right' : 'left',
                          index: 0,
                        },
                      })
                    }
                  >
                    Move to {lane === 'left' ? 'right' : 'left'} chain
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={editingDisabled}
                  onClick={() =>
                    void author({ kind: 'remove', block_id: selectedBlock })
                  }
                >
                  Remove block
                </Button>
              </>
            )}
          </div>
        </details>
      )}
      {!!status?.settings?.length && (
        <details>
          <summary>DSP settings</summary>
          <div
            className="action-row"
            role="group"
            aria-label="Prepared DSP settings"
          >
            {status.settings
              .filter(
                (setting) =>
                  !setting.target.startsWith('block:') ||
                  setting.target === `block:${selectedBlock}:slimSize`,
              )
              .map((setting) => (
                <Button
                  key={setting.target}
                  variant="outline"
                  disabled={editingDisabled}
                  onClick={() =>
                    setSettingDraft({
                      control: setting,
                      value: setting.value,
                      session: session,
                      revision: revision,
                    })
                  }
                >
                  {setting.label} · {setting.display}
                </Button>
              ))}
          </div>
        </details>
      )}
      {settingDraft && (
        <AdjustmentDialog
          title={settingDraft.control.label}
          onCancel={() => {
            if (!busy) setSettingDraft(null);
          }}
        >
          <TouchAdjust
            label="Prepared setting value"
            value={settingDraft.value}
            baseline={settingDraft.control.value}
            min={0}
            max={1}
            step={
              status?.setting_steps?.[settingDraft.control.target] ??
              (settingDraft.control.toggle ? 1 : 0.01)
            }
            disabled={busy}
            onChange={(value) =>
              setSettingDraft((old) => (old ? { ...old, value } : old))
            }
            format={(value) =>
              settingDraft.control.target.endsWith(':slimSize') &&
              (value === 0 || value === 1)
                ? value === 0
                  ? 'Lite'
                  : 'Full'
                : settingDraft.control.toggle
                  ? value === 1
                    ? 'On'
                    : 'Off'
                  : `${(value * 100).toFixed(1)}%`
            }
            commitHint="Audio restarts when applied."
          />
          <div className="action-row">
            <Button
              disabled={
                busy ||
                !Number.isFinite(settingDraft.value) ||
                session !== settingDraft.session ||
                revision !== settingDraft.revision
              }
              onClick={() => {
                void author({
                  kind: 'parameter',
                  parameter: settingDraft.control.target,
                  value: settingDraft.value,
                }).then(() => {
                  setSettingDraft(null);
                });
              }}
            >
              Apply
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setSettingDraft(null)}
            >
              Cancel
            </Button>
          </div>
        </AdjustmentDialog>
      )}
    </>
  );
}
