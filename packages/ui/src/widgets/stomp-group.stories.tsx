import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '../components/ui/button';
import {
  type StompAssignment,
  StompAssignmentDialog,
  StompSwitch,
} from './stomp-group';

export default {
  title: 'Rig/Stomp assignments',
  parameters: { layout: 'padded' },
} satisfies Meta;
const blocks = [
  { id: 'echo', name: 'Echo' },
  { id: 'bloom', name: 'Bloom' },
  { id: 'ts9', name: 'TS9' },
];
function Rig() {
  const [group, setGroup] = useState<StompAssignment>();
  const [editing, setEditing] = useState(false);
  const [scene, setScene] = useState('Dirt');
  const [on, setOn] = useState<Record<string, boolean>>({
    echo: false,
    bloom: false,
    ts9: true,
  });
  const next = scene === 'Dirt' ? 'Clean' : 'Dirt';
  const nextValues: Record<string, boolean> = {
    echo: next === 'Clean',
    bloom: next === 'Clean',
    ts9: next === 'Dirt',
  };
  const active = group?.nodes.filter((n) => on[n]).length ?? 0;
  return (
    <div className="grid max-w-lg gap-3">
      <Button variant="outline" onClick={() => setEditing(true)}>
        {group ? 'Edit stomp switch' : 'Assign a stomp switch'}
      </Button>
      {editing && (
        <StompAssignmentDialog
          initial={group}
          blocks={blocks}
          disabled={false}
          onClose={() => setEditing(false)}
          onSave={(name, nodes) => {
            setGroup({ id: 'wet', name, nodes });
            setEditing(false);
          }}
        />
      )}
      <p>Scene · {scene}</p>
      <Button
        onClick={() => {
          setScene(next);
          setOn({
            echo: next === 'Clean',
            bloom: next === 'Clean',
            ts9: next === 'Dirt',
          });
        }}
      >
        Recall {next}
      </Button>
      {group && (
        <StompSwitch
          name={group.name}
          enabled={active === group.nodes.length}
          partial={active > 0 && active < group.nodes.length}
          next={
            next +
            ' recall · ' +
            (group.nodes.every((n) => nextValues[n])
              ? 'On'
              : group.nodes.some((n) => nextValues[n])
                ? 'Mixed'
                : 'Off')
          }
          disabled={false}
          onPress={() =>
            setOn({
              ...on,
              ...Object.fromEntries(
                group.nodes.map((n) => [n, active !== group.nodes.length]),
              ),
            })
          }
        />
      )}
      {blocks.map((b) => (
        <Button
          key={b.id}
          variant="outline"
          aria-pressed={!!on[b.id]}
          onClick={() => setOn({ ...on, [b.id]: !on[b.id] })}
        >
          {b.name}
        </Button>
      ))}
    </div>
  );
}
export const AssignAndRecall: StoryObj = {
  render: () => <Rig />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      c.getByRole('button', { name: 'Assign a stomp switch' }),
    );
    const edit = within(page.getByRole('dialog'));
    await userEvent.type(edit.getByLabelText('Switch name'), 'Wet');
    for (const name of ['Echo', 'Bloom'])
      await userEvent.click(edit.getByRole('checkbox', { name }));
    await userEvent.click(
      edit.getByRole('button', { name: 'Save assignment' }),
    );
    await userEvent.click(c.getByRole('button', { name: 'TS9' }));
    await userEvent.click(c.getByRole('button', { name: 'Wet · Off' }));
    await expect(c.getByRole('button', { name: 'TS9' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await userEvent.click(c.getByRole('button', { name: 'Recall Clean' }));
    await expect(c.getByRole('button', { name: 'Wet · On' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(c.getByRole('button', { name: 'Wet · On' }));
    await userEvent.click(c.getByRole('button', { name: 'Recall Dirt' }));
    await expect(c.getByRole('button', { name: 'TS9' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(c.getByRole('button', { name: 'Wet · Off' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  },
};
