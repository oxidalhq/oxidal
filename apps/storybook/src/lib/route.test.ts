import { expect, it } from 'vitest';
import {
  addBranch,
  blocksOf,
  branchWith,
  isSplit,
  joinSplit,
  locate,
  moveStep,
  removeStep,
  startBranch,
  type Step,
} from './route';

type B = { id: string };
const b = (id: string): B => ({ id });
const ids = (route: Step<B>[]): unknown =>
  route.map((s) => (isSplit(s) ? s.branches.map(ids) : s.id));

const SERIAL: Step<B>[] = [
  b('gate'),
  b('drive'),
  b('amp'),
  b('cab'),
  b('delay'),
  b('reverb'),
];

it('moves a block along the main line in either direction', () => {
  expect(ids(moveStep(SERIAL, 'delay', [], 1))).toEqual([
    'gate',
    'delay',
    'drive',
    'amp',
    'cab',
    'reverb',
  ]);
  expect(ids(moveStep(SERIAL, 'drive', [], 4))).toEqual([
    'gate',
    'amp',
    'cab',
    'drive',
    'delay',
    'reverb',
  ]);
  expect(moveStep(SERIAL, 'amp', [], 2)).toBe(SERIAL);
});

it('runs a block in parallel with another, then joins back to one path', () => {
  const parallel = branchWith(SERIAL, 'amp', 'delay');
  expect(ids(parallel)).toEqual([
    'gate',
    'drive',
    [['amp'], ['delay']],
    'cab',
    'reverb',
  ]);
  const at = locate(parallel, 'delay');
  expect(at?.path).toEqual([2, 1]);
  const split = parallel[2]!;
  if (!isSplit(split)) throw new Error('expected a split');
  expect(ids(joinSplit(parallel, split.id))).toEqual([
    'gate',
    'drive',
    'amp',
    'delay',
    'cab',
    'reverb',
  ]);
});

it('splits again after a merge and inside a branch', () => {
  let route = branchWith(SERIAL, 'amp', 'drive'); // split 1 around amp
  route = branchWith(route, 'reverb', 'delay'); // split 2 later on the main line
  expect(ids(route)).toEqual([
    'gate',
    [['amp'], ['drive']],
    'cab',
    [['reverb'], ['delay']],
  ]);
  route = branchWith(route, 'amp', 'cab'); // nested inside branch A of split 1
  expect(ids(route)).toEqual([
    'gate',
    [[[['amp'], ['cab']]], ['drive']],
    [['reverb'], ['delay']],
  ]);
  expect(blocksOf(route).map((x) => x.id)).toEqual([
    'gate',
    'amp',
    'cab',
    'drive',
    'reverb',
    'delay',
  ]);
});

it('keeps a dry branch and adds branches; removing the last block of a branch tidies the split', () => {
  let route = startBranch(SERIAL, 'reverb');
  expect(ids(route)).toEqual([
    'gate',
    'drive',
    'amp',
    'cab',
    'delay',
    [['reverb'], []],
  ]);
  const split = route[5]!;
  if (!isSplit(split)) throw new Error('expected a split');
  route = addBranch(route, split.id);
  expect(ids(route)).toEqual([
    'gate',
    'drive',
    'amp',
    'cab',
    'delay',
    [['reverb'], [], []],
  ]);
  expect(ids(removeStep(route, 'reverb'))).toEqual([
    'gate',
    'drive',
    'amp',
    'cab',
    'delay',
  ]);
});

it('moves a block out of a branch onto the main line and flattens a one-branch split', () => {
  const parallel = branchWith(SERIAL, 'amp', 'delay');
  expect(ids(moveStep(parallel, 'delay', [], 0))).toEqual([
    'delay',
    'gate',
    'drive',
    [['amp'], []],
    'cab',
    'reverb',
  ]);
  const into = moveStep(parallel, 'cab', [2, 1], 1);
  expect(ids(into)).toEqual([
    'gate',
    'drive',
    [['amp'], ['delay', 'cab']],
    'reverb',
  ]);
});
