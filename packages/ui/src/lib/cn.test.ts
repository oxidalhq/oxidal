import { expect, it } from 'vitest';

import { cn } from './cn';

it('treats the named spacing tokens as sizes when an owner overrides them', () => {
  expect(cn('min-h-touch', 'min-h-12')).toBe('min-h-12');
  expect(cn('min-h-12', 'min-h-touch')).toBe('min-h-touch');
  expect(cn('px-page', 'px-0')).toBe('px-0');
  expect(cn('p-panel', 'p-3')).toBe('p-3');
  expect(cn('size-touch', 'size-13')).toBe('size-13');
});

it('keeps different pointer rules separate while merging their own sizes', () => {
  expect(
    cn('min-h-touch [@media(pointer:coarse)]:min-h-touch', 'min-h-12'),
  ).toBe('[@media(pointer:coarse)]:min-h-touch min-h-12');
  expect(
    cn(
      '[@media(pointer:coarse)]:min-h-touch',
      '[@media(pointer:coarse)]:min-h-13',
    ),
  ).toBe('[@media(pointer:coarse)]:min-h-13');
});
