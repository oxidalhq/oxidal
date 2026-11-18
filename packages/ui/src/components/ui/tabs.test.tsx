import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

afterEach(cleanup);

it('switches content with the arrow keys and shows one panel', async () => {
  const user = userEvent.setup();
  render(
    <Tabs defaultValue="a">
      <TabsList aria-label="Sections">
        <TabsTrigger value="a">Mine</TabsTrigger>
        <TabsTrigger value="b">Set list</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Panel A</TabsContent>
      <TabsContent value="b">Panel B</TabsContent>
    </Tabs>,
  );
  expect(screen.getByText('Panel A')).toBeVisible();
  expect(screen.queryByText('Panel B')).toBeNull();
  screen.getByRole('tab', { name: 'Mine' }).focus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'Set list' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByText('Panel B')).toBeVisible();
});
