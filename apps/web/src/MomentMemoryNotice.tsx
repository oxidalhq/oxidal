export function MomentMemoryNotice({ uri }: { uri?: string | null }) {
  if (!uri?.startsWith('urn:oxidal:plugin:moment#')) return null;
  return (
    <p className="text-sm text-muted-foreground">
      The caught loop lives in memory. Removing Moment or restarting the device
      clears it. Saving or exporting a preset keeps the control settings only.
      At full Clock, Moment holds four seconds. Turn Catch off to release the
      loop. It still plays when Mix is zero.
    </p>
  );
}
