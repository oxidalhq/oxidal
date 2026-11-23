import type { ReactNode } from 'react';

import { Eyebrow } from '../components/ui/text';

export function RigHeading({
  playing,
  identity,
  children,
}: {
  playing: boolean;
  identity: ReactNode;
  children: ReactNode;
}) {
  return (
    <header data-slot="rig-heading" className="grid gap-2 px-page pt-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="grid max-w-full min-w-0 gap-1">
          <Eyebrow>{playing ? 'Playing' : 'Rig'}</Eyebrow>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {identity}
          </div>
        </div>
        <div
          role="group"
          aria-label="Rig actions"
          className="flex flex-wrap items-center gap-2"
        >
          {children}
        </div>
      </div>
    </header>
  );
}
