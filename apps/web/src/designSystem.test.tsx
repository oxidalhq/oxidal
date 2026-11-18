import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Badge } from '@oxidal/design-system/components/badge';
import { Button } from '@oxidal/design-system/components/button';
import { parseSong } from '@oxidal/design-system/lib/song';

afterEach(cleanup);

/**
 * The web app builds against the design system package (`packages/ui`,
 * `@oxidal/design-system`) through its `exports` map. Screens move onto it
 * one at a time in the product rewrite; this proves the path.
 * @see docs/architecture.md
 */
it('renders design-system components and uses its helpers', () => {
  render(
    <>
      <Button variant="outline">Open</Button>
      <Badge tone="live">Playing</Badge>
    </>,
  );
  expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute(
    'data-variant',
    'outline',
  );
  expect(screen.getByText('Playing')).toHaveAttribute('data-tone', 'live');
  expect(parseSong('{title: Proof}', 'chordpro').title).toBe('Proof');
});
