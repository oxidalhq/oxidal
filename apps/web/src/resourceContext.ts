import { createContext, useContext } from 'react';

import type { useResourceStatus } from './useResourceStatus';

/**
 * The device readings App already follows (levels, DSP, CPU, xruns, clips),
 * shared with screens that show them, such as the Rig's edge lanes, so they
 * do not start a second feed or post the same notices twice.
 */
export const ResourceContext = createContext<ReturnType<
  typeof useResourceStatus
> | null>(null);

export const useResource = () => useContext(ResourceContext);
