import { useState } from 'react';
import type { AudioState, AudioAction } from './api';
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
  const layout = status.layout;
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
      {layout && (
        <details>
          <summary>Chain actions</summary>
          <div
            className="action-row"
            role="group"
            aria-label="Live chain actions"
          >
            <Button
              variant="outline"
              disabled={disabled || !status?.can_undo}
              onClick={() => void author({ kind: 'undo' })}
            >
              Undo structure
            </Button>
            <Button
              variant="outline"
              disabled={disabled || !status?.can_redo}
              onClick={() => void author({ kind: 'redo' })}
            >
              Redo structure
            </Button>
            <Button
              variant="outline"
              disabled={disabled}
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
              disabled={disabled || !layout.stereo}
              onClick={() =>
                void author({ kind: 'edit', edit: { kind: 'swap' } })
              }
            >
              Swap left/right
            </Button>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() =>
                void author({ kind: 'edit', edit: { kind: 'reset' } })
              }
            >
              Reset chain
            </Button>
            <Button
              variant="outline"
              disabled={disabled || !status.can_paste}
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
                disabled={disabled}
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
                  disabled={disabled}
                  onClick={() =>
                    void author({ kind: 'copy', block_id: selectedBlock })
                  }
                >
                  Copy block
                </Button>

                <Button
                  variant="outline"
                  disabled={disabled || position === 0}
                  onClick={() => reorder(-1)}
                >
                  Earlier
                </Button>
                <Button
                  variant="outline"
                  disabled={disabled || position === laneBlocks.length - 1}
                  onClick={() => reorder(1)}
                >
                  Later
                </Button>
                <Button
                  variant="outline"
                  disabled={disabled}
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
                    disabled={disabled}
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
                  disabled={disabled}
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
            {status.settings.map((setting) => (
              <Button
                key={setting.target}
                variant="outline"
                disabled={disabled}
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
              settingDraft.control.toggle
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
