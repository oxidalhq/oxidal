import { useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { PluginPanel } from '@oxidal/design-system/patterns/plugin-panel';

import { installedLv2, type Lv2Plugin, type RigControl } from '../../api';
import {
  liveLv2Controls,
  lv2PluginView,
  quickEffectLayout,
} from '../../lv2PluginPanel';
import { MomentMemoryNotice } from '../../MomentMemoryNotice';
import { PluginSourceDetails } from '../../PluginSourceDetails';
import { NamedSettings } from '../library/NamedSettings';
import { supportsNamedSettings } from '../library/namedSettingValues';
import { rigBusy } from './mixedRigViewModel';
import { QuickLv2Panel } from './QuickLv2Panel';
import type { RigViewProps } from './useMixedRigSession';

/** Live controls addressed by worker node and symbol. @see docs/lv2.md */
export function LiveLv2Panel({ rig, vm }: RigViewProps) {
  const { connected, command, open, setControlsTogether } = rig;
  const [expanded, setExpanded] = useState<string>();
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
  const panelKey = `${session}:${selected.id}:${selectedPluginUri}`;
  const quick = quickEffectLayout(selectedPluginUri);
  const canQuickEdit = !!(quick && bypass && controls.length);
  const onControl = (symbol: string, value: number) =>
    setControl(live.get(symbol), value);
  const onToggle = (on: boolean) => setControl(bypass, on ? 0 : 1);
  const onAdjust = (symbol: string) => {
    const control = live.get(symbol);
    if (control && !disabled) {
      const name = controls.find((item) => item.symbol === symbol)?.name;
      open(name ? { ...control, label: name } : control);
    }
  };
  if (quick && bypass && canQuickEdit && expanded !== panelKey)
    return (
      <QuickLv2Panel
        key={panelKey}
        id={selected.id}
        name={selectedView.label}
        layout={quick}
        controls={controls}
        bypass={bypass}
        disabled={disabled}
        onControl={onControl}
        onAdjust={onAdjust}
        onToggle={onToggle}
        onGesture={(values) => {
          if (disabled) return;
          const targets = values.flatMap(([symbol, value]) => {
            const control = live.get(symbol);
            return control && control.value !== value
              ? [[control.target, value] as [RigControl['target'], number]]
              : [];
          });
          if (targets.length)
            void setControlsTogether(targets, {
              restored:
                'The change did not go through. The previous values were restored.',
              partial:
                'Only part of the change went through. Check the effect values before trying again.',
            });
        }}
        onAll={() => setExpanded(panelKey)}
      />
    );
  return (
    <>
      {canQuickEdit && (
        <Button
          size="sm"
          variant="ghost"
          className="w-fit"
          onClick={() => setExpanded(undefined)}
        >
          Quick controls
        </Button>
      )}
      <PluginPanel
        key={panelKey}
        plugin={plugin ? lv2PluginView(plugin) : { name: selectedView.label }}
        controls={controls}
        mainCount={plugin ? undefined : controls.length}
        on={bypass?.value !== 1}
        toggleLabel={`${selectedView.label} on`}
        onToggle={bypass && onToggle}
        onControl={onControl}
        onRestoreDefaults={
          plugin && state.phase === 'running' && state.control
            ? () => {
                if (disabled || !state.control) return;
                void command({
                  kind: 'restore_plugin_defaults',
                  command: {
                    session: state.control.session,
                    expected_revision: state.control.revision,
                    node: selected.id,
                  },
                });
              }
            : undefined
        }
        onAdjust={onAdjust}
        disabled={disabled}
      />
      {plugin && state.control && supportsNamedSettings(plugin.uri) && (
        <NamedSettings
          key={panelKey}
          live
          block={{
            name: selectedView.label,
            plugin,
            controls: Object.fromEntries(
              Array.from(live, ([symbol, control]) => [symbol, control.value]),
            ),
          }}
          disabled={
            disabled ||
            state.phase !== 'running' ||
            !plugin.ports
              .filter((p) => p.control && p.input)
              .every((p) => live.has(p.symbol))
          }
          onApply={async (values) => {
            if (!state.control || disabled) return false;
            return command(
              {
                kind: 'apply_block_settings',
                command: {
                  session: state.control.session,
                  expected_revision: state.control.revision,
                  node: selected.id,
                },
                plugin: plugin.uri,
                controls: values,
              },
              true,
              state,
            );
          }}
        />
      )}
      {plugin && <PluginSourceDetails key={plugin.uri} plugin={plugin} />}
      <MomentMemoryNotice uri={selectedPluginUri} />
    </>
  );
}
