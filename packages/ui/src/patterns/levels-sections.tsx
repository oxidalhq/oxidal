import { Gauge, SpeakerHigh, Stethoscope } from '@phosphor-icons/react';

import type { Section } from './workspace';

export const LEVELS_SECTIONS = [
  { id: 'overview', label: 'Overview', icon: <Gauge aria-hidden="true" /> },
  {
    id: 'loudness',
    label: 'Loudness',
    icon: <SpeakerHigh aria-hidden="true" />,
  },
  {
    id: 'diagnostics',
    label: 'Diagnostics',
    icon: <Stethoscope aria-hidden="true" />,
  },
] as const satisfies readonly Section[];

export type LevelsSection = (typeof LEVELS_SECTIONS)[number]['id'];
