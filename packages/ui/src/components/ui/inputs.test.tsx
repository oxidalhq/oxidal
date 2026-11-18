import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Combobox } from './combobox';
import { NumberField } from './number-field';
import { EmptyState, StepProgress } from './states';

afterEach(cleanup);

it('a number field steps with the keyboard, fine with Shift, and clamps', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <NumberField
      label="Gain"
      value={9.5}
      onChange={onChange}
      min={0}
      max={10}
      step={0.5}
      fine={0.1}
    />,
  );
  const field = screen.getByRole('slider', { name: 'Gain' });
  expect(field).toHaveAttribute('aria-valuenow', '9.5');
  field.focus();
  await user.keyboard('{ArrowUp}');
  expect(onChange).toHaveBeenLastCalledWith(10);
  await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
  expect(onChange).toHaveBeenLastCalledWith(9.4);
  await user.keyboard('{End}');
  expect(onChange).toHaveBeenLastCalledWith(10);
  await user.keyboard('{PageDown}');
  // Ten steps down from 9.5 clamps at the floor.
  expect(onChange).toHaveBeenLastCalledWith(4.5);
  await user.keyboard('{Home}');
  expect(onChange).toHaveBeenLastCalledWith(0);
});

it('a number field opens for typing on Enter and commits the typed value', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <NumberField
      label="Tempo"
      value={120}
      onChange={onChange}
      min={40}
      max={240}
      digits={0}
    />,
  );
  screen.getByRole('slider', { name: 'Tempo' }).focus();
  await user.keyboard('{Enter}');
  const input = screen.getByRole('textbox', { name: 'Tempo' });
  await user.clear(input);
  await user.type(input, '132{Enter}');
  expect(onChange).toHaveBeenLastCalledWith(132);
  expect(screen.getByRole('slider', { name: 'Tempo' })).toBeVisible();
});

it('a combobox filters as you type and picks with Enter', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <Combobox
      label="Model"
      value={null}
      onChange={onChange}
      options={[
        { value: 'plexi', label: 'Plexi 50' },
        { value: 'twin', label: 'Twin clean' },
      ]}
    />,
  );
  await user.type(screen.getByRole('combobox', { name: 'Model' }), 'tw');
  const options = await screen.findAllByRole('option');
  expect(options).toHaveLength(1);
  expect(options[0]).toHaveTextContent('Twin clean');
  await user.keyboard('{Enter}');
  expect(onChange).toHaveBeenCalledWith('twin');
});

it('states announce politely', () => {
  render(
    <>
      <EmptyState title="No presets yet" />
      <StepProgress
        label="Playing"
        steps={['Load', 'Start']}
        current={0}
        onCancel={() => {}}
      />
    </>,
  );
  expect(screen.getAllByRole('status')).toHaveLength(2);
  expect(screen.getByText(/Step 1 of 2/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
  expect(screen.getByRole('progressbar', { name: 'Playing' })).toBeVisible();
});
