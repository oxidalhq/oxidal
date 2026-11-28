import { useEffect, useState } from 'react';

import type { PluginControl } from '@oxidal/design-system/patterns/plugin-panel';

import { installedLv2, type Lv2Plugin, type RigControl } from '../../api';
import { liveLv2Controls, quickEffectLayout } from '../../lv2PluginPanel';
import type { RigViewProps } from './useMixedRigSession';

/**
 * The installed LV2 plugins, read once per session and sample rate, so the
 * chain and the block box can show each effect's own kind, names and units.
 * @see docs/lv2.md
 */
export function useLv2Catalog({ rig, vm }: RigViewProps) {
  const { connected } = rig;
  const session = vm.state.control?.session;
  const rate = vm.state.configured?.stream?.input?.sample_rate ?? 48000;
  const [catalog, setCatalog] = useState<{
    session: string;
    rate: number;
    plugins: Lv2Plugin[];
  }>();
  useEffect(() => {
    if (!connected || !session) return;
    let active = true;
    void Promise.resolve()
      .then(() => installedLv2(rate))
      .then(
        (plugins) => {
          if (active && plugins) setCatalog({ session, rate, plugins });
        },
        () => {
          if (active) setCatalog(undefined);
        },
      );
    return () => {
      active = false;
    };
  }, [connected, rate, session]);
  return connected && catalog?.session === session && catalog?.rate === rate
    ? catalog.plugins
    : [];
}

/**
 * One effect's controls with the plugin's names and units, the live control
 * behind each, and the main ones to show first: the effect's own layout for
 * Oxidal effects, else its first ordinary controls.
 */
export function effectControls(
  plugins: readonly Lv2Plugin[],
  uri: string | undefined,
  node: string,
  controls: readonly RigControl[],
) {
  const live = new Map<string, RigControl>();
  for (const control of controls)
    if (control.target.kind === 'lv2' && control.target.node === node)
      live.set(control.target.symbol, control);
  const plugin = plugins.find((item) => item.uri === uri);
  const all: PluginControl[] = liveLv2Controls(plugin, live).filter(
    (control) => !control.hidden,
  );
  const layout = quickEffectLayout(uri);
  const main: PluginControl[] = (
    layout
      ? layout.main.flatMap((symbol) => {
          const found = all.find((c) => c.symbol === symbol);
          return found ? [found] : [];
        })
      : all.filter((c) => c.kind === 'range')
  ).slice(0, 4);
  return {
    controls: all,
    live,
    layout,
    main,
    /** The plugin's own kind, such as "Reverb". */
    category: plugin?.category ?? undefined,
  };
}

/** A main value as the chain card and block box show it: "2.0 s". */
export function shortValue(c: PluginControl) {
  if (c.kind === 'choice')
    return (
      c.choices?.find((x) => x.value === c.value)?.label ?? String(c.value)
    );
  const digits = c.integer ? 0 : Math.abs(c.value) >= 100 ? 0 : 1;
  return `${c.value.toFixed(digits)}${c.unit ? ` ${c.unit}` : ''}`;
}

/** The selected LV2 effect's controls. */
export function useLv2Controls(props: RigViewProps) {
  const plugins = useLv2Catalog(props);
  const { selected, selectedPluginUri, visibleControls } = props.vm;
  return effectControls(
    plugins,
    selectedPluginUri,
    selected?.kind === 'lv2' ? selected.id : '',
    visibleControls,
  );
}
