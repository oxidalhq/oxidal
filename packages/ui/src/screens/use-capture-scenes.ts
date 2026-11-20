import { useState } from 'react';

import type { RigRoute } from '../patterns/rig-surface';
import type { SceneModel } from '../widgets/scene-editor';
import { CAPTURE_ROUTE, CAPTURE_SCENES } from './four-captures.fixtures';
export function useCaptureScenes() {
  const [route, onRoute] = useState<RigRoute>(CAPTURE_ROUTE);
  const [scenes, onScenes] = useState<SceneModel[]>(CAPTURE_SCENES);
  const [open, onOpenChange] = useState(false);
  return { route, onRoute, scenes, onScenes, open, onOpenChange };
}
