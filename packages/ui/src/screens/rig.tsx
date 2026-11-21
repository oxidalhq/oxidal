import { useState } from 'react';

import { Button } from '../components/ui/button';
import { Card, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { EFFECTS } from '../patterns/block-chooser.data';
import { NamBlockToolsDemo } from '../patterns/nam-block.demo';
import { SCENES, SERIAL_ROUTE } from '../patterns/rig.fixtures';
import { RigSurface } from '../patterns/rig-surface';
import { useModelDownloads } from '../patterns/swap.demo';
import { BLOCK_TYPES, MODELS } from '../patterns/swap.fixtures';
import { useRigDemo } from '../patterns/use-rig.demo';
import { PresetSteps } from '../widgets/preset-steps';
import { CAPTURE_ROUTE, CAPTURE_SCENES } from './four-captures.fixtures';

/** The Rig screen: the rig surface, or the card that says why audio is not playing. */
export function Rig({ audio = true }: { audio?: boolean }) {
  const [position, setPosition] = useState(0);
  const rhythm = useRigDemo(CAPTURE_ROUTE, CAPTURE_SCENES);
  const echo = useRigDemo(SERIAL_ROUTE);
  const rig = position === 0 ? rhythm : echo;
  const store = useModelDownloads(MODELS);
  if (!audio)
    return (
      <div className="grid gap-4 px-page pt-4">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Audio playback unavailable</CardTitle>
          </CardHeader>
          <p className="m-0 text-sm text-muted-foreground">
            This device cannot play audio right now. You can still browse and
            edit presets; check Audio setup if an interface should be connected.
          </p>
          <CardFooter>
            <Button>Browse presets</Button>
            <Button variant="outline">Audio setup</Button>
            <Button variant="outline">Tuner</Button>
          </CardFooter>
        </Card>
      </div>
    );
  return (
    <RigSurface
      blockTools={(b) => b.kind === 'amp' && <NamBlockToolsDemo />}
      models={store.models}
      blockTypes={BLOCK_TYPES}
      effects={EFFECTS}
      downloads={store.downloads}
      onGetModel={store.onGet}
      catalogue={store.catalogue}
      key={position}
      presetName={position === 0 ? 'Rhythm section' : 'Echo lead'}
      presetSteps={
        <PresetSteps
          previous={position === 1 ? 'Rhythm section' : undefined}
          next={position === 0 ? 'Echo lead' : undefined}
          onStep={(dir) =>
            setPosition((n) => Math.max(0, Math.min(1, n + dir)))
          }
        />
      }
      playing
      route={rig.route}
      saved={rig.saved}
      onRoute={rig.onRoute}
      versions={rig.versions}
      currentVersion={rig.current}
      onVersion={rig.onVersion}
      onSaveVersion={rig.onSaveVersion}
      onSaveVersionAs={rig.onSaveVersionAs}
      onMakeDefault={rig.onMakeDefault}
      scenes={rig.settings ?? (position === 0 ? CAPTURE_SCENES : SCENES)}
      sceneSettings={rig.settings}
      savedSceneSettings={rig.savedSettings}
      onSceneSettings={rig.setSettings}
      activeScene={rig.scene}
      onScene={rig.onScene}
      sceneChanged={rig.sceneChanged}
      levels={rig.levels}
      inputLevel={rig.input}
      onAudition={rig.onAudition}
      onAdd={rig.onAdd}
    />
  );
}
