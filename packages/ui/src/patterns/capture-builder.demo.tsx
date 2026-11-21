import { useState } from 'react';

import { Button } from '../components/ui/button';
import { CaptureBuilder, type CapturePlan } from './capture-builder';
import { models } from './capture-builder.fixtures';
export function CaptureBuilderDemo() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  return open ? (
    <CaptureBuilder
      models={models.filter((m) =>
        m.name.toLowerCase().includes(search.toLowerCase()),
      )}
      cabinets={[{ id: 'cab1', name: 'Studio cabinet' }]}
      busy={false}
      search={search}
      onSearch={setSearch}
      more={false}
      onMore={() => {}}
      onSave={(plan: CapturePlan) => {
        setName(plan.name);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  ) : (
    <div>
      {name && <p role="status">Saved {name}</p>}
      <Button
        onClick={() => {
          setOpen(true);
          setSearch('');
        }}
      >
        Build a rig from captures
      </Button>
    </div>
  );
}
