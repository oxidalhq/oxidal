import type { BlockModel } from './block-editor';
import { MicPlacement, type Mic } from './mic-placement';

/**
 * A cab block's microphones, read from and written to its controls:
 * `mic-position`, `mic-angle` and `distance` for mic A; the same with
 * `mic-b-` for mic B when the cab has two; `mic-blend` between them. The
 * names come from the block's `mics`.
 */
export function CabMics({
  block,
  onControl,
  compact = false,
  disabled = false,
  className,
}: {
  block: BlockModel;
  onControl: (control: string, value: number) => void;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const value = (id: string, fallback: number) =>
    block.controls.find((c) => c.id === id)?.value ?? fallback;
  const names = block.mics ?? ['Mic'];
  const mics: Mic[] = [
    {
      name: names[0]!,
      position: value('mic-position', 0.3),
      angle: value('mic-angle', 0),
      distance: value('distance', 2),
    },
  ];
  if (names[1] && block.controls.some((c) => c.id === 'mic-b-position'))
    mics.push({
      name: names[1],
      position: value('mic-b-position', 0.6),
      angle: value('mic-b-angle', 30),
      distance: value('mic-b-distance', 8),
    });
  return (
    <MicPlacement
      compact={compact}
      disabled={disabled}
      className={className}
      mics={mics}
      blend={mics.length > 1 ? value('mic-blend', 50) : undefined}
      onBlend={
        mics.length > 1 ? (blend) => onControl('mic-blend', blend) : undefined
      }
      onChange={(index, mic) => {
        const prefix = index === 0 ? 'mic-' : 'mic-b-';
        const before = mics[index]!;
        if (mic.position !== before.position)
          onControl(`${prefix}position`, mic.position);
        if (mic.angle !== before.angle) onControl(`${prefix}angle`, mic.angle);
        if (mic.distance !== before.distance)
          onControl(index === 0 ? 'distance' : 'mic-b-distance', mic.distance);
      }}
    />
  );
}
