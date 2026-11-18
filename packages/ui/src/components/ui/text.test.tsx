import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { Caption, Eyebrow, Label, Readout } from './text';

afterEach(cleanup);

it('renders each text style with its element and classes', () => {
  render(
    <>
      <Eyebrow>Rig</Eyebrow>
      <Label htmlFor="level">Level</Label>
      <Readout size="lg" id="level">
        −12.0 dB
      </Readout>
      <Caption>Peak hold 3 s</Caption>
    </>,
  );
  expect(screen.getByText('Rig').className).toContain('small-caps');
  expect(screen.getByText('Level').tagName).toBe('LABEL');
  expect(screen.getByText('−12.0 dB').className).toContain('tabular-nums');
  expect(screen.getByText('Peak hold 3 s').tagName).toBe('P');
});

it('lets a style take another element', () => {
  render(<Caption as="span">inline</Caption>);
  expect(screen.getByText('inline').tagName).toBe('SPAN');
});
