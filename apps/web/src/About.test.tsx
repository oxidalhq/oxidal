import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { About } from './About';

afterEach(cleanup);

it('describes Oxidal and credits its author without a license section', () => {
  render(<About />);
  expect(screen.getByRole('heading', { name: 'Oxidal' })).toBeVisible();
  expect(screen.getByText('Richard Sentino')).toBeVisible();
  expect(screen.getByText(/Full and Lite A2 models can be mixed per block/)).toBeVisible();
  expect(
    screen.queryByRole('heading', { name: /license/i }),
  ).not.toBeInTheDocument();
});
