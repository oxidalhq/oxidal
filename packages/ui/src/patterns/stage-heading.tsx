import type { ReactNode } from 'react';

import { Caption, Eyebrow, Title } from '../components/ui/text';

export function StageHeading({
  name,
  state,
  detail,
  compact = false,
}: {
  name: string;
  state: ReactNode;
  detail: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      data-slot="stage-heading"
      className="grid min-w-0 justify-items-center gap-1 text-center"
    >
      <Eyebrow className="inline-flex items-center gap-1.5">
        {state}
      </Eyebrow>
      <Title
        key={name}
        aria-live="polite"
        size={compact ? 'lg' : 'display'}
        className="w-full text-balance break-words motion-safe:animate-arrive"
      >
        {name}
      </Title>
      <Caption
        as="div"
        className="flex flex-wrap items-center justify-center gap-x-2 text-sm"
      >
        {detail}
      </Caption>
    </div>
  );
}
