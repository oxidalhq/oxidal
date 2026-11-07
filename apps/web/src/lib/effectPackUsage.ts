/**
 * Which saved presets need an effect pack, from the LV2 plugin URIs each
 * preset lists (7.17). Prefixes follow the curated packs' published URIs.
 * @see docs/interface.md
 */
export type PresetPlugins = { name: string; plugins: readonly string[] };

const prefixes: Record<string, readonly string[]> = {
  guitarix: ['http://guitarix.sourceforge.net/'],
  dragonfly: ['urn:dragonfly:', 'https://github.com/michaelwillis/dragonfly'],
  calf: ['http://calf.sourceforge.net/'],
  invada: ['http://invadarecords.com/'],
  x42: ['http://gareus.org/'],
  mda: ['http://drobilla.net/plugins/mda/'],
  swh: ['http://plugin.org.uk/'],
  fomp: ['http://drobilla.net/plugins/fomp/'],
};

/** Names of presets using any effect from `pack`, sorted; an unknown pack is unused. */
export function presetsUsingPack(
  pack: string,
  presets: readonly PresetPlugins[],
): string[] {
  const own = prefixes[pack] ?? [];
  return [
    ...new Set(
      presets
        .filter((p) =>
          p.plugins.some((uri) => own.some((prefix) => uri.startsWith(prefix))),
        )
        .map((p) => p.name),
    ),
  ].sort((a, b) => a.localeCompare(b));
}
