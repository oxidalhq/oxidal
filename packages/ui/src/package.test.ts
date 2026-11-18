import { describe, expect, it } from 'vitest';
import pkg from '../package.json';

/**
 * The design system is a package the app imports. Every component, widget
 * and pattern must be reachable through `exports`, and none may build in
 * example data or pretend to be the device: those live in `*.data.ts`,
 * `*.fixtures.ts` and `*.demo.tsx`, which only stories and the reference
 * screens use.
 */
const sources = import.meta.glob<string>(
  [
    './components/ui/*.{ts,tsx}',
    './widgets/*.{ts,tsx}',
    './patterns/*.{ts,tsx}',
  ],
  { query: '?raw', import: 'default', eager: true },
);
const helper = /\.(stories|test|data|fixtures|demo)\.tsx?$/;
const modules = Object.entries(sources).filter(([path]) => !helper.test(path));
const exportsMap = pkg.exports as Record<string, string | null>;

/** Resolves a package subpath the way Node and Vite read `exports`. */
function resolve(subpath: string): string | null | undefined {
  if (subpath in exportsMap) return exportsMap[subpath];
  const patterns = Object.keys(exportsMap)
    .filter((key) => key.includes('*'))
    .map((key) => {
      const [before, after] = key.split('*') as [string, string];
      return { key, before, after };
    })
    .filter(
      ({ before, after }) =>
        subpath.startsWith(before) &&
        subpath.endsWith(after) &&
        subpath.length >= before.length + after.length,
    )
    .sort(
      (a, b) =>
        b.before.length - a.before.length || b.key.length - a.key.length,
    );
  const best = patterns[0];
  if (!best) return undefined;
  const target = exportsMap[best.key];
  if (target === null || target === undefined) return target;
  const star = subpath.slice(
    best.before.length,
    subpath.length - best.after.length,
  );
  return target.replace('*', star);
}

describe('the @oxidal/design-system package', () => {
  it.each(modules.map(([path]) => path))('exports %s', (path) => {
    const file = path.replace(/^\.\//, '');
    const [folder, name] = file.startsWith('components/ui/')
      ? ['components', file.slice('components/ui/'.length)]
      : (file.split('/') as [string, string]);
    const subpath = `./${folder}/${name.replace(/\.tsx?$/, '')}`;
    const target =
      subpath === './components/notices'
        ? exportsMap['./notices']
        : resolve(subpath);
    expect(target).toBe(`./src/${file}`);
  });

  it.each(modules.map(([path]) => path))(
    '%s uses no example data or demo',
    (path) => {
      const text = sources[path]!;
      const bad = text
        .split('\n')
        .filter(
          (line) =>
            /from '[^']*\.(data|fixtures|demo)'/.test(line) &&
            !/^import type /.test(line),
        );
      expect(bad).toEqual([]);
    },
  );

  it('does not export demos', () => {
    expect(resolve('./patterns/tone3000.demo')).toBeNull();
    expect(resolve('./widgets/scene-editor.demo')).toBeNull();
  });
});
