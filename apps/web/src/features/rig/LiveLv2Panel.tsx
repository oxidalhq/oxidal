import { useEffect, useState } from 'react';

import { PluginPanel } from '@oxidal/design-system/patterns/plugin-panel';

import { installedLv2, type Lv2Plugin, type RigControl } from '../../api';
import { liveLv2Controls, lv2PluginView } from '../../lv2PluginPanel';
import { PluginSourceDetails } from '../../PluginSourceDetails';
import { rigBusy } from './mixedRigViewModel';
import type { RigViewProps } from './useMixedRigSession';

/** Live LV2 controls in the shared panel, addressed by worker node and symbol. */
export function LiveLv2Panel({ rig, vm }: RigViewProps) {
  const { connected, command, open } = rig;
  const { state, selected, selectedPluginUri, selectedView, visibleControls } =
    vm;
  const session = state.control?.session;
  const rate = state.configured?.stream?.input?.sample_rate ?? 48000;
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

  if (!selected || !selectedView) return null;
  const plugin =
    connected && catalog?.session === session && catalog?.rate === rate
      ? catalog.plugins.find((item) => item.uri === selectedPluginUri)
      : undefined;
  const live = new Map<string, RigControl>();
  for (const control of visibleControls) {
    const { target } = control;
    if (target.kind === 'lv2' && target.node === selected.id) {
      live.set(target.symbol, control);
    }
  }
  const bypass = selectedView.branch ? undefined : selectedView.bypass;
  const disabled = rigBusy(vm, rig);
  const setControl = (control: RigControl | undefined, value: number) => {
    if (!control || !state.control || disabled) return;
    void command({
      kind: 'control',
      command: {
        session: state.control.session,
        expected_revision: state.control.revision,
        target: control.target,
        value,
      },
    });
  };
  const controls = liveLv2Controls(plugin, live);
  return (
    <>
      <PluginPanel
        key={`${session}:${selected.id}:${selectedPluginUri}`}
        plugin={plugin ? lv2PluginView(plugin) : { name: selectedView.label }}
        controls={controls}
        mainCount={plugin ? undefined : controls.length}
        on={bypass?.value !== 1}
        toggleLabel={`${selectedView.label} on`}
        onToggle={bypass && ((on) => setControl(bypass, on ? 0 : 1))}
        onControl={(symbol, value) => setControl(live.get(symbol), value)}
        onAdjust={(symbol) => {
          const control = live.get(symbol);
          if (control && !disabled) {
            const name = controls.find((item) => item.symbol === symbol)?.name;
            open(name ? { ...control, label: name } : control);
          }
        }}
        disabled={disabled}
      />
      {plugin && <PluginSourceDetails key={plugin.uri} plugin={plugin} />}
      {selectedPluginUri?.startsWith('urn:oxidal:plugin:moment#') && (
        <p className="text-sm text-muted-foreground">
          The caught loop is memory only: it is not saved or exported and is
          lost when this effect is removed or the device restarts. At full Clock
          it holds four seconds. Mix at zero does not silence a caught loop;
          turn Catch off to let it go.
        </p>
      )}
    </>
  );
}
