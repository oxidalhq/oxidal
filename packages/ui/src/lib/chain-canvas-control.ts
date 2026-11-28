import { useCallback, useMemo, useRef, useState } from 'react';

import { useRemembered } from './use-remembered';

/**
 * Lets something outside the chain map (the chain bar under it) drive the
 * map: zoom, fit, centre on the selected block, the list view, the minimap
 * and Follow. Give the same control to `ChainCanvas` (`control`) and to the
 * bar. The map reports its zoom and hands over its commands; the bar reads
 * the state and calls the commands.
 * @see docs/interface.md
 */

export type ChainCanvasCommands = {
  zoomIn: () => void;
  zoomOut: () => void;
  /** Fit the whole chain in the space. */
  fit: () => void;
  /** Bring the selected block to the middle. */
  centre: () => void;
  /** Move the drawing by this many CSS pixels, as dragging it would. */
  panBy: (dx: number, dy: number) => void;
};

export type ChainCanvasControl = ChainCanvasCommands & {
  /** The map's zoom: 1 is full size. */
  zoom: number;
  /** The map moves to show a block when it is selected or moved. */
  follow: boolean;
  setFollow: (on: boolean) => void;
  minimap: boolean;
  setMinimap: (on: boolean) => void;
  /** The chain is shown as a list instead of a map. */
  list: boolean;
  setList: (on: boolean) => void;
  /** Called by the map when its zoom changes. */
  reportZoom: (zoom: number) => void;
  /**
   * Where the top of the drawing is, in CSS pixels from the top of the map.
   * A header over the map turns solid once the drawing passes under it.
   */
  drawingTop: number;
  /** Called by the map when the drawing moves up or down. */
  reportTop: (top: number) => void;
  /** Called by the map with its commands, and with null when it goes away. */
  attach: (commands: ChainCanvasCommands | null) => void;
};

export function useChainCanvasControl(): ChainCanvasControl {
  const [zoom, setZoom] = useState(1);
  const [drawingTop, setDrawingTop] = useState(Infinity);
  const [follow, setFollow] = useState(true);
  // The same remembered choice as the map's own minimap button.
  const [minimap, setMinimap] = useRemembered('oxidal.canvas.minimap', false);
  const [list, setList] = useState(false);
  const commands = useRef<ChainCanvasCommands | null>(null);
  const attach = useCallback((next: ChainCanvasCommands | null) => {
    commands.current = next;
  }, []);
  const run = useCallback(
    (name: Exclude<keyof ChainCanvasCommands, 'panBy'>) =>
      commands.current?.[name](),
    [],
  );
  const panBy = useCallback(
    (dx: number, dy: number) => commands.current?.panBy(dx, dy),
    [],
  );
  return useMemo(
    () => ({
      zoom,
      follow,
      setFollow,
      minimap,
      setMinimap,
      list,
      setList,
      reportZoom: setZoom,
      drawingTop,
      reportTop: setDrawingTop,
      attach,
      zoomIn: () => run('zoomIn'),
      zoomOut: () => run('zoomOut'),
      fit: () => run('fit'),
      centre: () => run('centre'),
      panBy,
    }),
    [zoom, drawingTop, follow, minimap, setMinimap, list, attach, run, panBy],
  );
}
