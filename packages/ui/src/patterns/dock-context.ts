import * as React from 'react';

/** Where a panel is: closed, in a sheet, floating over the page, or pinned to a side. */
export type ToolPlace = 'closed' | 'sheet' | 'float' | 'left' | 'right';
export type ToolPlaces = Record<string, ToolPlace>;

/** What the dock offers to anything that can be kept open (see `DockableSheet`). */
export type Dock = {
  /** Wide enough to float. */
  tablet: boolean;
  /** Wide enough to pin. */
  wide: boolean;
  placeOf: (id: string) => ToolPlace;
  put: (id: string, place: ToolPlace) => void;
  /** Where pinned and floating panels are drawn. */
  slots: {
    left: HTMLElement | null;
    right: HTMLElement | null;
    float: HTMLElement | null;
  };
  spotOf: (id: string) => { x: number; y: number };
  setSpot: (id: string, spot: { x: number; y: number }) => void;
};

export const DockContext = React.createContext<Dock | null>(null);

/** Where the app shell wants the tool buttons (its masthead); null draws them above the page. */
export const LauncherSlotContext = React.createContext<HTMLElement | null>(
  null,
);
