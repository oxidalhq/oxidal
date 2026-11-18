import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { Combobox } from './combobox';
import { NumberField } from './number-field';
import { EmptyState, StepProgress } from './states';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('restores a cancelled numeric gesture and ignores a different pointer', () => {
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      pointerId: number;
      constructor(
        type: string,
        event: MouseEventInit & { pointerId?: number },
      ) {
        super(type, event);
        this.pointerId = event.pointerId ?? 1;
      }
    },
  );
  const change = vi.fn();
  render(
    <NumberField
      label="Gain"
      value={0.5}
      min={0}
      max={1}
      step={0.1}
      fine={0.01}
      onChange={change}
    />,
  );
  const field = screen.getByRole('slider', { name: 'Gain' });
  Object.assign(field, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  });
  fireEvent.pointerDown(field, {
    button: 0,
    pointerId: 1,
    clientX: 100,
    clientY: 100,
  });
  fireEvent.pointerMove(field, { pointerId: 1, clientX: 104, clientY: 100 });
  expect(change).toHaveBeenLastCalledWith(0.6);
  fireEvent.pointerCancel(field, { pointerId: 2 });
  expect(change).toHaveBeenCalledTimes(1);
  fireEvent.pointerCancel(field, { pointerId: 1 });
  expect(change).toHaveBeenLastCalledWith(0.5);
  fireEvent.lostPointerCapture(field, { pointerId: 1 });
  expect(change).toHaveBeenCalledTimes(2);
});

it('rejects partially numeric exact entry and accepts a decimal comma', async () => {
  const change = vi.fn();
  const user = userEvent.setup();
  render(
    <NumberField
      label="Gain"
      value={5}
      min={0}
      max={10}
      step={0.1}
      onChange={change}
    />,
  );
  await user.click(screen.getByRole('slider', { name: 'Gain' }));
  const input = screen.getByRole('textbox', { name: 'Gain' });
  await user.clear(input);
  await user.type(input, '2junk{Enter}');
  expect(change).not.toHaveBeenCalled();
  expect(input).toHaveAttribute('aria-invalid', 'true');
  await user.clear(input);
  await user.type(input, '7,2{Enter}');
  expect(change).toHaveBeenCalledExactlyOnceWith(7.2);
});

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
