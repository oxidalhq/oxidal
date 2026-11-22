import { Button } from '../components/ui/button';
import { Card, CardFooter, CardHeader, CardTitle } from '../components/ui/card';

export function RigAudioUnavailable({
  onLibrary,
  onAudioSetup,
  onTuner,
  error,
}: {
  onLibrary?: () => void;
  onAudioSetup?: () => void;
  onTuner?: () => void;
  error?: string | null;
}) {
  return (
    <div className="grid gap-4 px-page pt-4">
      <Card aria-label="Rig playback" className="max-w-2xl">
        <CardHeader>
          <CardTitle>Audio playback unavailable</CardTitle>
        </CardHeader>
        <p className="m-0 text-sm text-muted-foreground">
          This device cannot play audio right now. You can still browse and edit
          presets; check Audio setup if an interface should be connected.
        </p>
        {error && <p role="alert">{error}</p>}
        <CardFooter>
          <Button onClick={onLibrary}>Browse presets</Button>
          <Button variant="outline" onClick={onAudioSetup}>
            Audio setup
          </Button>
          <Button variant="outline" onClick={onTuner}>
            Tuner
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
