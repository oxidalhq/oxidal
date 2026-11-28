import { useEffect, useState } from 'react';

import { Loading } from '@oxidal/design-system/components/states';
import {
  ENGINE_EFFECTS,
  oxidalEffectsFromCatalogue,
} from '@oxidal/design-system/lib/oxidal-effects';
import {
  type BuiltInEffect,
  BuiltInEffects,
} from '@oxidal/design-system/patterns/engine-settings';

import { capabilities, installedLv2, playbackState } from './api';
import { friendlyError } from './lib/friendlyError';

export function InstalledEffects({ connected }: { connected: boolean }) {
  const [inventory, setInventory] = useState<{
    own: BuiltInEffect[];
    engine: BuiltInEffect[];
  }>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!connected) return;
    let active = true;
    void Promise.all([playbackState(), capabilities()])
      .then(async ([audio, device]) => {
        const effects = await installedLv2(
          audio.configured?.stream?.input?.sample_rate ?? 48000,
        );
        if (!active) return;
        setInventory({
          own: oxidalEffectsFromCatalogue(effects),
          engine: device.native_editor ? [...ENGINE_EFFECTS] : [],
        });
        setError('');
      })
      .catch((cause: unknown) => {
        if (active)
          setError(friendlyError(cause, 'read the installed effects'));
      });
    return () => {
      active = false;
    };
  }, [connected]);
  if (!connected)
    return (
      <p role="status">Connect to the device to see its installed effects.</p>
    );
  if (error) return <p role="alert">{error}</p>;
  return inventory ? (
    <BuiltInEffects {...inventory} />
  ) : (
    <Loading label="Reading installed effects…" />
  );
}
