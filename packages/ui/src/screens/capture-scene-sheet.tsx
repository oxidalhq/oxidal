import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
} from '../components/ui/sheet';
import { SceneEditor } from '../widgets/scene-editor';
import type { useCaptureScenes } from './use-capture-scenes';
export function CaptureSceneSheet({
  editor,
  active,
  onSelect,
}: {
  editor: ReturnType<typeof useCaptureScenes>;
  active: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Sheet open={editor.open} onOpenChange={editor.onOpenChange}>
      <SheetContent onOpenChange={editor.onOpenChange}>
        <SheetHeader
          title="Edit scenes"
          description="Rhythm section · Switch each capture, cabinet or effect on or off for each scene."
        />
        <SheetBody>
          <SceneEditor {...editor} active={active} onSelect={onSelect} />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
