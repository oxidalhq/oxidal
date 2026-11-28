import { useRemembered } from '@oxidal/design-system/lib/use-remembered';

/** The chain drawn as a map or as a tree; this browser remembers which. */
export function useChainView() {
  // The key changed when the map became the default, so a device that
  // remembered the tree from before starts on the map once.
  return useRemembered<'tree' | 'map'>('oxidal.rig.chain-view.2', 'map');
}
