import { ScenePads } from '@/widgets/scene-pad';
import { SCENES } from '@/patterns/rig.fixtures';

/** The scenes as a compact strip under a chord sheet, or large when there is no sheet. */
export function SceneStrip({
  active,
  onSelect,
  large = false,
}: {
  active: string;
  onSelect: (id: string) => void;
  large?: boolean;
}) {
  return (
    <ScenePads
      scenes={SCENES}
      active={active}
      onSelect={onSelect}
      size={large ? 'lg' : 'md'}
      className="grid-cols-4"
    />
  );
}
