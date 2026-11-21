import { useState } from 'react';

import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';

export type StompAssignment = { id: string; name: string; nodes: string[] };
export type StompBlock = { id: string; name: string };

export function StompSwitch({
  name,
  enabled,
  partial,
  next,
  disabled,
  onPress,
}: {
  name: string;
  enabled: boolean;
  partial: boolean;
  next?: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <Button
        variant={enabled && !partial ? 'default' : 'outline'}
        aria-pressed={partial ? 'mixed' : enabled}
        disabled={disabled}
        onClick={onPress}
      >
        {name} · {partial ? 'Mixed' : enabled ? 'On' : 'Off'}
      </Button>
      {next && <span className="text-xs text-muted-foreground">{next}</span>}
    </div>
  );
}

export function StompAssignmentDialog({
  initial,
  blocks,
  disabled,
  onClose,
  onSave,
  onRemove,
}: {
  initial?: StompAssignment;
  blocks: StompBlock[];
  disabled: boolean;
  onClose: () => void;
  onSave: (name: string, nodes: string[]) => void;
  onRemove?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [nodes, setNodes] = useState(initial?.nodes ?? []);
  const [confirm, setConfirm] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader
          title={initial ? 'Edit stomp switch' : 'Assign a stomp switch'}
          description="One press switches these blocks together. Recalling a scene restores its saved settings."
          closeLabel="Close"
        />
        <DialogBody className="grid min-w-0 gap-3">
          <label className="grid gap-1">
            Switch name
            <input
              className="min-h-touch rounded-md border px-2"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <fieldset className="grid gap-1">
            <legend>Assigned blocks</legend>
            {blocks.map((b) => (
              <label className="flex min-h-touch items-center gap-2" key={b.id}>
                <input
                  type="checkbox"
                  checked={nodes.includes(b.id)}
                  disabled={
                    disabled || (!nodes.includes(b.id) && nodes.length >= 16)
                  }
                  onChange={(e) =>
                    setNodes(
                      e.target.checked
                        ? [...nodes, b.id]
                        : nodes.filter((n) => n !== b.id),
                    )
                  }
                />
                {b.name}
              </label>
            ))}
          </fieldset>
          {confirm && (
            <p role="status">
              Remove this switch assignment? The blocks stay in the rig.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {onRemove && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => (confirm ? onRemove() : setConfirm(true))}
            >
              {confirm ? 'Confirm removal' : 'Remove assignment'}
            </Button>
          )}
          <Button
            disabled={
              disabled ||
              !name.trim() ||
              !nodes.length ||
              new TextEncoder().encode(name.trim()).length > 80
            }
            onClick={() => onSave(name.trim(), nodes)}
          >
            Save assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
