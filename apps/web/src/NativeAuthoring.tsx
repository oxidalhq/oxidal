import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { NativeTools } from './NativeTools';
import { ToolRow, ToolSection } from './ToolRow';
import { useEffect, useRef, useState } from 'react';
import { tone3000Tone, type AudioState, type AudioAction } from './api';
import { Button } from './components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { AdjustmentDialog } from './AdjustmentDialog';
import { SettingDialog } from './SettingDialog';
import { formatDefault, settingHelp } from './engineHelp';
const inputLabels = {
  stereo: {
    name: 'Stereo',
    detail:
      'The left input feeds the left chain and the right input the right.',
  },
  left: {
    name: 'Left only',
    detail: 'Only the left input feeds the preset; the right input is ignored.',
  },
  right: {
    name: 'Right only',
    detail: 'Only the right input feeds the preset; the left input is ignored.',
  },
  dual: {
    name: 'Dual mono',
    detail: 'Each input runs through its own copy of a mono chain.',
  },
} as const;

export function NativeAuthoring({
  status,
  historyControls = true,
  scope = 'all',
  settingsScope = 'rig',
  collapseSettings = false,
  onEngineSettings,
  selectedBlock,
  disabled,
  busy,
  session,
  revision,
  author,
}: {
  historyControls?: boolean;
  /** `split`: block tools when a block is selected, rig setup otherwise. */
  scope?: 'split' | 'all';
  /** Where engine settings live: this unit (native) or this rig (hybrid node). */
  settingsScope?: 'unit' | 'rig';
  /** Keep Routing and Engine closed under one "Preset settings" row. */
  collapseSettings?: boolean;
  /** Opens Settings → Audio, where unit-scope engine settings live. */
  onEngineSettings?: () => void;
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
  const [confirm, setConfirm] = useState<'remove' | 'reset' | null>(null);
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
  // Insertion slots are positions, not blocks the player sees.
  const placed = laneBlocks.filter((b) => !b.insert);
  const variants = laneBlocks[position]?.variants ?? [];
  const activeVariant = variants.findIndex(
    (model) => model.id === laneBlocks[position]?.active_model,
  );
  function selectVariant(index: number) {
    if (editingDisabled || busy || !selectedBlock || !variants[index]) return;
    void author({
      kind: 'select_model',
      block_id: selectedBlock,
      model_id: variants[index].id,
    });
  }
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
      {variants.length > 1 && (
        <div className="variant-selector" aria-label="Model comparison">
          <Button
            variant="outline"
            aria-label="Previous model variant"
            disabled={editingDisabled || busy || activeVariant <= 0}
            onClick={() => selectVariant(activeVariant - 1)}
          >
            <CaretLeft aria-hidden="true" />
          </Button>
          <label className="field min-w-0">
            Model variant · {activeVariant >= 0 ? activeVariant + 1 : '—'} /{' '}
            {variants.length}
            <Select
              disabled={editingDisabled || busy}
              value={String(laneBlocks[position]?.active_model ?? '')}
              onValueChange={(value) =>
                selectVariant(
                  variants.findIndex((model) => model.id === Number(value)),
                )
              }
            >
              <SelectTrigger aria-label="Model variant">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {variants.map((model) => (
                  <SelectItem key={model.id} value={String(model.id)}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Button
            variant="outline"
            aria-label="Next model variant"
            disabled={
              editingDisabled ||
              busy ||
              activeVariant < 0 ||
              activeVariant >= variants.length - 1
            }
            onClick={() => selectVariant(activeVariant + 1)}
          >
            <CaretRight aria-hidden="true" />
          </Button>
        </div>
      )}
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
      {historyControls && (
        <div className="tool-row-actions">
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
        </div>
      )}
      {status.history_error && (
        <p role="status" className="caption" title={status.history_error}>
          Undo history unavailable
        </p>
      )}
      {layout && selectedBlock && position >= 0 && (
        <ToolSection title="This block" scope="Saved with this preset">
          <div role="group" aria-label="Live chain actions">
            <ToolRow
              title="Position"
              value={`${lane === 'left' ? 'Left' : 'Right'} ${placed.findIndex((b) => b.id === selectedBlock) + 1} of ${placed.length}`}
              detail={
                layout.stereo
                  ? 'Move it earlier or later in its chain, or over to the other chain.'
                  : 'Move it earlier or later in the chain.'
              }
            >
              {historyControls && (
                <>
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
                </>
              )}
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
            </ToolRow>
            <ToolRow
              title="Copies"
              detail="Duplicate adds a copy right after this block. Copy keeps it on this device so you can paste it into any preset."
            >
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
              <Button
                variant="outline"
                disabled={editingDisabled}
                onClick={() =>
                  void author({ kind: 'copy', block_id: selectedBlock })
                }
              >
                Copy block
              </Button>
              {status.can_paste && (
                <Button
                  variant="outline"
                  aria-label="Paste block"
                  disabled={editingDisabled}
                  onClick={() =>
                    void author({
                      kind: 'edit',
                      edit: { kind: 'paste', lane, index: position + 1 },
                    })
                  }
                >
                  Paste after this
                </Button>
              )}
            </ToolRow>
            {status.settings
              ?.filter(
                (setting) =>
                  setting.target === `block:${selectedBlock}:slimSize`,
              )
              .map((setting) => (
                <ToolRow
                  inline
                  key={setting.target}
                  title="Model size"
                  value={setting.display}
                  detail="Lite uses less DSP; Full runs the complete model. Changing it restarts audio briefly."
                >
                  <Button
                    variant="outline"
                    aria-label={`${setting.label} · ${setting.display}`}
                    disabled={editingDisabled}
                    onClick={() =>
                      setSettingDraft({
                        control: setting,
                        value: setting.value,
                        session,
                        revision,
                      })
                    }
                  >
                    Change…
                  </Button>
                </ToolRow>
              ))}
            <ToolRow
              inline
              title="Remove"
              detail="Takes this block out of the chain. Undo brings it back."
            >
              <Button
                variant="outline"
                disabled={editingDisabled}
                onClick={() => setConfirm('remove')}
              >
                Remove block
              </Button>
            </ToolRow>
          </div>
        </ToolSection>
      )}
      {layout && (scope === 'all' || !selectedBlock) && (
        <SettingsGroup collapsed={collapseSettings}>
          <ToolSection title="Routing" scope="Saved with this preset">
            <ToolRow
              title="Input"
              value={inputLabels[layout.input_mode ?? 'stereo'].name}
              detail={inputLabels[layout.input_mode ?? 'stereo'].detail}
            >
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
            </ToolRow>
            <ToolRow
              title="Chains"
              value={layout.stereo ? 'Stereo (left + right)' : 'Mono'}
              detail={
                layout.stereo
                  ? 'Two chains run side by side, one per output side. Swap exchanges them.'
                  : 'One chain feeds both outputs.'
              }
            >
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
              {layout.stereo && (
                <Button
                  variant="outline"
                  disabled={editingDisabled}
                  onClick={() =>
                    void author({ kind: 'edit', edit: { kind: 'swap' } })
                  }
                >
                  Swap left/right
                </Button>
              )}
            </ToolRow>
            <ToolRow
              inline
              title="Start over"
              detail="Clears every block from this preset's chain. Undo brings them back; the saved preset is untouched until you Save."
            >
              <Button
                variant="outline"
                disabled={editingDisabled}
                onClick={() => setConfirm('reset')}
              >
                Reset chain
              </Button>
            </ToolRow>
          </ToolSection>
          <NativeTools status={status} disabled={disabled} author={author} />
          {settingsScope === 'unit' ? (
            <ToolSection title="Engine" scope="This unit, not this preset">
              <ToolRow
                inline
                title="Loudness, calibration, oversampling, pitch engine"
                detail="These apply to every preset on this unit, so they live in Settings → Audio."
              >
                {onEngineSettings && (
                  <Button variant="outline" onClick={onEngineSettings}>
                    Open
                  </Button>
                )}
              </ToolRow>
            </ToolSection>
          ) : status?.settings?.some(
              (setting) => !setting.target.startsWith('block:'),
            ) ? (
            <ToolSection title="Engine" scope="Saved with this preset">
              <p className="tool-row-detail">
                Applying a change restarts audio briefly.
              </p>
              <div role="group" aria-label="Prepared DSP settings">
                {status.settings
                  .filter((setting) => !setting.target.startsWith('block:'))
                  .map((setting) => (
                    <ToolRow
                      inline
                      key={setting.target}
                      title={setting.label}
                      value={
                        formatDefault(setting.target, setting.value) ??
                        setting.display
                      }
                      detail={
                        settingHelp[setting.target] ?? 'Native engine setting.'
                      }
                    >
                      <Button
                        variant="outline"
                        aria-label={`${setting.label} · ${setting.display}`}
                        disabled={editingDisabled}
                        onClick={() =>
                          setSettingDraft({
                            control: setting,
                            value: setting.value,
                            session,
                            revision,
                          })
                        }
                      >
                        Change…
                      </Button>
                    </ToolRow>
                  ))}
              </div>
            </ToolSection>
          ) : null}
        </SettingsGroup>
      )}
      {confirm && (
        <AdjustmentDialog
          title={
            confirm === 'remove' ? 'Remove this block?' : 'Reset the chain?'
          }
          onCancel={() => setConfirm(null)}
        >
          <p>
            {confirm === 'remove'
              ? 'The block leaves the chain now. Undo brings it back.'
              : 'Every block leaves this preset’s chain now. Undo brings them back.'}
          </p>
          <div className="action-row">
            <Button
              disabled={editingDisabled}
              onClick={() => {
                setConfirm(null);
                if (confirm === 'remove' && selectedBlock)
                  void author({ kind: 'remove', block_id: selectedBlock });
                else void author({ kind: 'edit', edit: { kind: 'reset' } });
              }}
            >
              {confirm === 'remove' ? 'Remove' : 'Reset chain'}
            </Button>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Keep
            </Button>
          </div>
        </AdjustmentDialog>
      )}
      {settingDraft && (
        <SettingDialog
          control={settingDraft.control}
          detail={settingHelp[settingDraft.control.target]}
          step={status?.setting_steps?.[settingDraft.control.target]}
          busy={busy}
          stale={
            session !== settingDraft.session ||
            revision !== settingDraft.revision
          }
          onCancel={() => setSettingDraft(null)}
          onApply={(value) =>
            author({
              kind: 'parameter',
              parameter: settingDraft.control.target,
              value,
            }).then(() => setSettingDraft(null))
          }
        />
      )}
    </>
  );
}

/** Rig setup that is rarely touched while playing: closed by default on Rig. */
function SettingsGroup({
  collapsed,
  children,
}: {
  collapsed: boolean;
  children: React.ReactNode;
}) {
  if (!collapsed) return <>{children}</>;
  return (
    <details className="control-help rig-preset-settings">
      <summary>Preset settings · routing and engine</summary>
      {children}
    </details>
  );
}
