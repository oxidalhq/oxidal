import { Badge } from '@oxidal/design-system/components/badge';

import type { mixedRigViewModel } from './mixedRigViewModel';

type MixedRigViewModel = ReturnType<typeof mixedRigViewModel>;

/** How much the native blocks ask of the device: models, chain blocks, A2 size, oversampling. */
export function NativeLoad({
  load,
}: {
  load: MixedRigViewModel['nativeLoad'];
}) {
  if (load.engines === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Native processing load">
      <Badge>
        {load.engines} {load.engines === 1 ? 'NAM block' : 'NAM blocks'}
      </Badge>
      <Badge>{load.blocks} chain blocks</Badge>
      {load.full + load.lite + load.scaled > 0 && (
        <Badge>
          A2 size · {load.full} Full · {load.lite} Lite
          {load.scaled > 0 ? ` · ${load.scaled} scaled` : ''}
        </Badge>
      )}
      {!!load.oversampling.length && (
        <Badge>Oversampling · {load.oversampling.join(' / ')}</Badge>
      )}
    </div>
  );
}
