import { describe, expect, it } from 'vitest';
import { blocksOf, isSplit, updateBlock } from './route';
import { applyScene, splitSceneEdit } from './scene';
import { FOUR_JOBS, FOUR_SCENES } from '../widgets/scene-editor.fixtures';

const verse = FOUR_SCENES[0]!;

describe('editing a scene from the chain', () => {
  it('sends on or off to the scene and keeps the preset as it was', () => {
    const shown = applyScene(FOUR_JOBS, verse);
    const next = updateBlock(shown, 'cab-gb', (b) => ({ ...b, on: false }));
    const edit = splitSceneEdit(next, FOUR_JOBS, verse);
    expect(edit.scene.on['cab-gb']).toBe(false);
    expect(blocksOf(edit.route).find((b) => b.id === 'cab-gb')?.on).toBe(true);
  });

  it('sends branch levels to the scene', () => {
    const shown = applyScene(FOUR_JOBS, verse);
    const next = shown.map((s) =>
      isSplit(s) ? { ...s, levels: [0, -3, -60, -10] } : s,
    );
    const edit = splitSceneEdit(next, FOUR_JOBS, verse);
    expect(edit.scene.levels.jobs).toEqual([0, -3, -60, -10]);
    const split = edit.route.find(isSplit);
    expect(split?.levels).toEqual([0, -60, -60, -8]);
  });

  it('sends settings to the preset', () => {
    const shown = applyScene(FOUR_JOBS, verse);
    const next = updateBlock(shown, 'ts9', (b) => ({
      ...b,
      controls: b.controls.map((c) => ({ ...c, value: 9 })),
    }));
    const edit = splitSceneEdit(next, FOUR_JOBS, verse);
    const ts9 = blocksOf(edit.route).find((b) => b.id === 'ts9')!;
    expect(ts9.controls.every((c) => c.value === 9)).toBe(true);
    expect(edit.scene.on.ts9).toBe(false);
  });
});
