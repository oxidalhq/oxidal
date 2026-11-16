import type { BlockModel } from '@/widgets/block-editor';

/** The preview line each block shows in the chain, from its main values. */
export function previewOf(block: BlockModel) {
  return block.controls
    .filter((c) => c.main)
    .slice(0, 2)
    .map(
      (c) =>
        `${c.value.toFixed(c.step && c.step >= 1 ? 0 : 1)}${c.unit ? ` ${c.unit}` : ''}`,
    )
    .join(' · ');
}
