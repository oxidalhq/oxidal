import { useEffect, useState } from 'react';

import { Loading } from '@oxidal/design-system/components/states';
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
          own: effects
            .filter(
              (effect) =>
                effect.uri.startsWith('urn:oxidal:') && !effect.unsupported,
            )
            .map((effect) => ({
              name: effect.name,
              caption: effect.comment || "Oxidal's own · Rust · built in",
            })),
          engine: device.native_editor
            ? [
                { name: 'Hold', caption: 'Freezes a note' },
                { name: 'Swell', caption: 'Volume swells' },
                {
                  name: 'Pitch',
                  caption: 'Pitch shift · enabled in NAM engine',
                },
              ]
            : [],
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
