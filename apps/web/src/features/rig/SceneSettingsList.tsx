import type { ReactNode } from 'react';

import { Checkbox } from '@oxidal/design-system/components/checkbox';
import { Caption } from '@oxidal/design-system/components/text';

/**
 * A list of settings a scene can keep, grouped by the effect or capture they
 * belong to: the setting's name, its value, how it changes between scenes,
 * and a tick to keep it. Names read "Oxidal Motion (Stereo) · Rate"; the part
 * before the last dot is the group, the rest is the setting.
 * @see docs/interface.md
 */
export type SceneSettingRow = {
  key: string;
  label: string;
  display: string;
  /** How it changes between scenes, such as "Glides". */
  how?: string;
  inScenes: boolean;
  changed?: boolean;
  checked: boolean;
  onToggle: () => void;
};

export function SceneSettingsList({
  title,
  help,
  rows,
}: {
  title: string;
  help: ReactNode;
  rows: SceneSettingRow[];
}) {
  const groups = new Map<string, SceneSettingRow[]>();
  for (const row of rows) {
    const at = row.label.lastIndexOf(' · ');
    const group = at > 0 ? row.label.slice(0, at) : 'Settings';
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return (
    <fieldset className="grid min-w-0 gap-3">
      <legend className="mb-1 font-semibold">{title}</legend>
      <Caption className="m-0">{help}</Caption>
      {[...groups.entries()].map(([group, items]) => (
        <section
          key={group}
          aria-label={group}
          className="grid min-w-0 overflow-hidden rounded-lg border border-border bg-card"
        >
          <h4 className="m-0 border-b border-border bg-secondary/40 px-3 py-1.5 text-xs font-semibold small-caps text-muted-foreground">
            {group}
          </h4>
          <ul className="m-0 grid list-none divide-y divide-border p-0">
            {items.map((row) => {
              const at = row.label.lastIndexOf(' · ');
              const name = at > 0 ? row.label.slice(at + 3) : row.label;
              return (
                <li key={row.key}>
                  <label className="grid min-h-touch cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-1.5">
                    <Checkbox
                      checked={row.checked}
                      disabled={row.inScenes}
                      onCheckedChange={row.onToggle}
                      aria-label={`${row.label} ${row.display}`}
                    />
                    <span className="grid min-w-0">
                      <span className="truncate text-sm font-medium">
                        {name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[
                          row.how,
                          row.inScenes ? 'In every scene' : undefined,
                          row.changed ? 'Changed' : undefined,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="font-mono text-sm tabular-nums">
                      {row.display}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </fieldset>
  );
}
