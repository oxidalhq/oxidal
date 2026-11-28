import { useMedia } from './use-media';
import { useRemembered } from './use-remembered';

/**
 * Where a block's every control opens. On a laptop or wider they open in
 * place, inside the block card under the curve, so tone chasing is one
 * press away and the chain stays in view; the choice to keep them open is
 * remembered. On narrower screens they open in a sheet.
 */
export function useAllControls() {
  const inPlace = useMedia('(min-width: 64rem)');
  const [open, setOpen] = useRemembered('oxidal.rig.all-controls-open', false);
  return {
    /** Every control shows in the card. */
    inPlace,
    /** Open in the card now. */
    open: inPlace && open,
    toggle: () => setOpen(!open),
  };
}
