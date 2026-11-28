import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { Lv2Plugin, Preset, RigAudioState, RigDocument } from '../../api';
import { lv2Effect, type NativeDraft, sceneRig } from '../../rigDraft';
import {
  buildRoute,
  buildSceneRoute,
  readRoute,
  routeInsertAt,
  routeSplitAt,
} from '../../rigRoute';
import { addSceneEffect } from '../../sceneEdit';
import { mixedRigViewModel } from './mixedRigViewModel';
import { RigChainSurface } from './RigChainSurface';
import type { RigViewProps } from './useMixedRigSession';

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.display;
});

const audio = (index: number, symbol: string, input: boolean) => ({
  index,
  symbol,
  audio: true,
  control: false,
  atom: false,
  input,
  output: !input,
  integer: false,
  toggled: false,
  logarithmic: false,
  latency: false,
  minimum: null,
  maximum: null,
  default: null,
});
const plugin: Lv2Plugin = {
  name: 'Echo',
  uri: 'urn:example:echo',
  unsupported: null,
  ports: [
    audio(0, 'in_l', true),
    audio(1, 'out_l', false),
    audio(2, 'in_r', true),
    audio(3, 'out_r', false),
  ],
};
const fx = (id: string) => ({ ...lv2Effect(plugin), id, name: id });
const revision = 'r'.repeat(64);
const doc = (manifest_json: string) =>
  ({ revision, manifest: JSON.parse(manifest_json) }) as RigDocument;

const serial = () =>
  doc(
    buildRoute('p', 'Serial', [fx('comp'), fx('drive')], 'prof').manifest_json,
  );
const parallel = () =>
  doc(
    buildRoute(
      'p',
      'Parallel',
      routeSplitAt(
        [fx('verb')],
        { split: null, path: 0, index: 0 },
        fx('pitch'),
      ),
      'prof',
    ).manifest_json,
  );
/** Scene lanes with Comp ahead of them and an echo after the lead's tone. */
function scenes() {
  const preset = { sha256: 'a'.repeat(64), name: 'Tone', size_bytes: 1 };
  const tone = (id: string): NativeDraft => ({
    id,
    kind: 'native',
    name: id,
    preset: preset as Preset,
    source: { kind: 'original', preset: preset.sha256 },
  });
  const base = doc(
    sceneRig(
      '68448a6d-0168-4fc8-b337-c12959165271',
      'Scenes',
      [tone('clean'), tone('lead')],
      'tone3000-plugin:' + 'a'.repeat(40),
    ).manifest_json,
  );
  const echo = doc(addSceneEffect(base, 'lead', fx('echo')).manifest_json);
  const route = routeInsertAt(
    readRoute(echo, [plugin], {}),
    { split: null, path: 0, index: 0 },
    fx('comp'),
  );
  return doc(buildSceneRoute(echo, route).manifest_json);
}
/** Two amps feeding one cab, with no input or output nodes. */
function graph() {
  const document = serial();
  document.manifest.oxidal!.graph = {
    nodes: ['amp-a', 'amp-b', 'cab'].map((id) => ({
      id,
      kind: 'lv2',
      instance: id,
      audioInputs: 2,
      audioOutputs: 2,
    })),
    edges: ['amp-a', 'amp-b'].map((id) => ({
      from: { node: id, port: 0 },
      to: { node: 'cab', port: 0 },
    })),
  } as NonNullable<RigDocument['manifest']['oxidal']>['graph'];
  return document;
}

function show(matching: RigDocument) {
  const state = {
    phase: 'running',
    configured: { revision, stream: { input: { sample_rate: 48000 } } },
    control: { controls: [], eq: [], slots: [] },
  } as unknown as RigAudioState;
  const vm = mixedRigViewModel({
    state,
    connected: true,
    matching,
    revision,
    selection: { revision, node: '' },
    nativeSelection: null,
    busy: false,
    eqBusy: false,
    readError: '',
    edit: null,
    saveOpening: null,
    sceneDraft: null,
    sceneUpdates: null,
    gears: {},
    narrow: false,
    switching: false,
  });
  const rig = {
    canvasChoice: null,
    edit: null,
    editing: false,
    picker: null,
    switching: false,
    dropBlock: vi.fn(),
    selectLaneTile: vi.fn(),
    setCanvasChoice: vi.fn(),
    setLaneSlot: vi.fn(),
    setRoutingSplit: vi.fn(),
    shift: vi.fn(),
    shiftPath: vi.fn(),
  };
  render(
    <RigChainSurface
      rig={rig as unknown as RigViewProps['rig']}
      vm={vm as RigViewProps['vm']}
    />,
  );
  return {
    rig,
    vm,
    chain: screen.getByRole('group', { name: 'Signal chain' }),
  };
}
const blocks = (chain: HTMLElement) =>
  [...chain.querySelectorAll('[data-node]')].map(
    (el) => (el as HTMLElement).dataset.node,
  );

it('draws a straight chain with a + in every gap', () => {
  const { chain } = show(serial());
  expect(blocks(chain)).toEqual(['comp', 'drive']);
  expect(
    within(chain).getAllByRole('button', { name: /^Add or split at/ }),
  ).toHaveLength(3);
  expect(
    screen.queryByRole('region', { name: 'Mixed signal chain' }),
  ).toBeNull();
});

it('draws a split as paths, with its levels in the split row', () => {
  const { chain, rig } = show(parallel());
  const split = within(chain).getByRole('group', { name: 'Split · 2 paths' });
  expect(within(split).getByText('Path 1 · 100% · Centre')).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Split 1 · 2 paths: path levels' }),
  );
  expect(rig.setRoutingSplit).toHaveBeenCalledTimes(1);
});

it('draws scene lanes with an effect ahead of them, a + ahead of the scenes and none ahead of a tone', () => {
  const { chain, rig, vm } = show(scenes());
  expect(vm.editable).toBe(true);
  expect(blocks(chain)).toEqual(['comp', 'clean', 'lead', 'echo']);
  expect(
    within(chain).getByRole('group', { name: 'Scene lanes' }),
  ).toBeVisible();
  // Ahead of Comp, and between Comp and the scenes.
  fireEvent.click(
    within(chain).getByRole('button', { name: 'Add or split at position 2' }),
  );
  expect(rig.setCanvasChoice).toHaveBeenCalledWith({
    kind: 'gap',
    at: { split: null, path: 0, index: 1 },
  });
  expect(
    within(chain).getByRole('button', { name: 'Add or split at position 1' }),
  ).toBeVisible();
  expect(
    within(chain).queryByRole('button', {
      name: 'Add or split on scene 1 at position 1',
    }),
  ).toBeNull();
  expect(
    within(chain).getByRole('button', {
      name: 'Add or split on scene 1 at position 2',
    }),
  ).toBeVisible();
  // The keyboard path for a drag: Alt+arrow moves Comp into the scenes.
  fireEvent.keyDown(
    within(chain).getByRole('button', {
      name: /^comp (?:pedal|lv2|time|Delay · Reverb)$/i,
    }),
    {
      key: 'ArrowRight',
      altKey: true,
    },
  );
  expect(rig.shift).toHaveBeenCalledWith('comp', 1);
});

it('draws a graph the route editor cannot read through the same renderer, read only', () => {
  const { chain, rig, vm } = show(graph());
  expect(vm.editable).toBe(false);
  expect(blocks(chain)).toEqual(['amp-a', 'amp-b', 'cab']);
  const split = within(chain).getByRole('group', { name: 'Split · 2 paths' });
  // Folded paths have no known levels.
  expect(within(split).getByText('Path 1')).toBeVisible();
  expect(
    within(chain).queryByRole('button', { name: /^Add or split/ }),
  ).toBeNull();
  expect(screen.getByText(/cannot be rearranged/)).toBeVisible();
  fireEvent.click(chain.querySelector('[data-node="amp-a"] button')!);
  expect(rig.selectLaneTile).toHaveBeenCalledWith('amp-a::');
});

it('lists an editable chain on E-paper and keeps buttons for every step', () => {
  document.documentElement.dataset.display = 'epaper';
  const { chain } = show(scenes());
  const list = within(chain).getByRole('list', { name: 'Chain as a list' });
  expect(list.textContent).toMatch(/comp.*Scenes.*clean.*lead.*echo/);
  expect(
    within(list).getByRole('button', { name: /Add effect at the end/ }),
  ).toBeEnabled();
});
