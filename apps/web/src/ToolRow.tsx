import type { ReactNode } from 'react';

import { Caption, Readout } from '@oxidal/design-system/components/text';
import {
  SettingGroup,
  SettingRow,
} from '@oxidal/design-system/patterns/settings-page';

/** One explained setting or action: name, current value, what it does, controls. */
export function ToolRow({
  title,
  value,
  detail,
  children,
  inline = false,
}: {
  /** A single action sits beside the text instead of below it. */
  inline?: boolean;
  title: string;
  value?: ReactNode;
  detail: ReactNode;
  children?: ReactNode;
}) {
  return (
    <SettingRow
      label={
        <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
          {title}
          {value != null && <Readout className="break-words">{value}</Readout>}
        </span>
      }
      caption={detail}
      stacked={!inline}
      className={
        inline
          ? 'max-sm:grid-cols-1 max-sm:[&>div:last-child]:justify-start'
          : undefined
      }
    >
      {children}
    </SettingRow>
  );
}

/** A titled group of rows with a note on where its values live. */
export function ToolSection({
  title,
  scope,
  label,
  className = '',
  children,
}: {
  title: string;
  scope: string;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label ?? title} className={className}>
      <SettingGroup
        title={
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            {title}
            <Caption as="span" className="normal-case">
              {scope}
            </Caption>
          </span>
        }
      >
        {children}
      </SettingGroup>
    </section>
  );
}
