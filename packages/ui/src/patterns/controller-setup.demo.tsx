import * as React from 'react';

import { CONTROLLERS } from '../widgets/controllers';
import {
  ControllerSetup,
  ExtraControllers,
  type ListenPolicy,
  type SwitchHeard,
} from './controller-setup';

/** Stands in for the device: a pressed tile is heard as CC 16 onwards on channel 1. */
export function ControllerSetupDemo() {
  const [heard, setHeard] = React.useState<SwitchHeard[]>([]);
  const [saved, setSaved] = React.useState(false);
  return (
    <ControllerSetup
      profiles={CONTROLLERS}
      heard={heard}
      saved={saved}
      onPress={(profile, id) =>
        setHeard((h) => [
          ...h,
          {
            switch: id,
            message: `CC ${16 + profile.switches.findIndex((s) => s.id === id)} · ch 1`,
          },
        ])
      }
      onSave={() => setSaved(true)}
    />
  );
}

export function ExtraControllersDemo() {
  const [policy, setPolicy] = React.useState<ListenPolicy>('all');
  return (
    <ExtraControllers
      controllers={[
        'M-Vave Chocolate · USB · connected',
        'MIDI Captain STD 10 · USB · connected',
      ]}
      policy={policy}
      onPolicy={setPolicy}
    />
  );
}
