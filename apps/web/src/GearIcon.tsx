import {
  SpeakerHigh,
  SpeakerSimpleHigh,
  SquaresFour,
  SlidersHorizontal,
  Cube,
  Waveform,
  Buildings,
  Flask,
} from '@phosphor-icons/react';
const gearTypes = {
  amp: { label: 'Amp head', icon: SpeakerSimpleHigh },
  'amp-cab': { label: 'Amp + cab', icon: SquaresFour },
  'full-rig': { label: 'Amp + cab', icon: SquaresFour },
  cab: { label: 'Cabinet', icon: SpeakerHigh },
  pedal: { label: 'Pedal', icon: Cube },
  outboard: { label: 'Outboard', icon: SlidersHorizontal },
  space: { label: 'Space', icon: Buildings },
  experimental: { label: 'Experimental', icon: Flask },
  ir: { label: 'Impulse response', icon: Waveform },
};
export function GearLabel({ gear }: { gear: string }) {
  return gearTypes[gear as keyof typeof gearTypes]?.label ?? (gear || 'Model');
}
/** Unknown provider categories remain visible; never guess an amp from a title. */
export function GearIcon({
  gear,
  className,
}: {
  gear: string;
  className?: string;
}) {
  const Icon = gearTypes[gear as keyof typeof gearTypes]?.icon ?? Waveform;
  return <Icon aria-hidden="true" className={className} />;
}
