/** How many scene colours the theme defines (`--scene-1` to `--scene-8`). */
export const SCENE_COLOURS = 8;

/**
 * A scene's colour, given in order: Scene 1 the first, and so on, then
 * round again. Players will be able to choose their own later. E-paper
 * draws every scene colour in ink.
 */
export const sceneColour = (index: number) =>
  `var(--scene-${(((index % SCENE_COLOURS) + SCENE_COLOURS) % SCENE_COLOURS) + 1})`;
