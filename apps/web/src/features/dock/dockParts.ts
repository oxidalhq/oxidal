import { createContext, useContext } from 'react';

import type { DockParts } from '@oxidal/design-system/patterns/dock-zones';

/** The dock's bottom zone, for a screen that places it itself (the Rig, above its chain bar). */
export const DockPartsContext = createContext<DockParts | null>(null);

export const useDockParts = () => useContext(DockPartsContext);
