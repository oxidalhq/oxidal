import type { ReactNode } from 'react';
import './RigTools.css';

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
    <div className="tool-row" data-inline={inline || undefined}>
      <div className="tool-row-head">
        <span className="tool-row-title">{title}</span>
        {value != null && <span className="tool-row-value">{value}</span>}
      </div>
      <p className="tool-row-detail">{detail}</p>
      {children && <div className="tool-row-actions">{children}</div>}
    </div>
  );
}

/** A titled group of rows with a note on where its values live. */
export function ToolSection({
  title,
  scope,
  label,
  children,
}: {
  title: string;
  scope: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <section className="tool-section" aria-label={label ?? title}>
      <h3>
        {title}
        <span>{scope}</span>
      </h3>
      {children}
    </section>
  );
}
