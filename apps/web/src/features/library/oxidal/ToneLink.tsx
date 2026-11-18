import { ArrowSquareOut } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { toneLink } from '../../../toneLink';

/**
 * A link to a tone's page on TONE3000, where its author, models and licence
 * can be checked. Built from the tone id, so it needs no TONE3000 request.
 * @see docs/factory-collection.md
 */
export function ToneLink({
  tone,
  url,
  children,
}: {
  tone: number;
  url?: string;
  children?: ReactNode;
}) {
  return (
    <a
      className="oxidal-tone-link"
      href={toneLink({ id: tone, url: url ?? '' })}
      target="_blank"
      rel="noreferrer noopener"
      title="Opens the tone on TONE3000"
    >
      {children ?? `Tone ${tone}`}
      <ArrowSquareOut aria-hidden="true" />
    </a>
  );
}
