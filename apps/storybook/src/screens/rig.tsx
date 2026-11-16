import { Button } from '../components/ui/button';
import { Card, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { RigSurface } from '../patterns/rig-surface';
import { SCENES, SERIAL_ROUTE } from '../patterns/rig.fixtures';
import { useRigDemo } from '../patterns/use-rig-demo';

/** The Rig screen: the rig surface, or the card that says why audio is not playing. */
export function Rig({ audio = true }: { audio?: boolean }) {
  const rig = useRigDemo(SERIAL_ROUTE);
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
      presetName="Rhythm section"
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
      scenes={SCENES}
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
