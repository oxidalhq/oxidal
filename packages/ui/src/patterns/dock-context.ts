import * as React from 'react';

/** Where a panel is: closed, in a sheet, floating over the page, or pinned to a side. */
export type ToolPlace = 'closed' | 'sheet' | 'float' | 'left' | 'right';
export type ToolPlaces = Record<string, ToolPlace>;

export type ToolPosition = {
  x: number;
  y: number;
  width?: number;
  height?: number;
};

/** What the dock offers to anything that can be kept open (see `DockableSheet`). */
export type Dock = {
  /** Wide enough to float. */
  tablet: boolean;
  /** Wide enough to pin. */
  wide: boolean;
  preferredPlace: (id: string) => ToolPlace;
  put: (id: string, place: ToolPlace) => void;
  /** Where pinned and floating panels are drawn. */
  slots: {
    left: HTMLElement | null;
    right: HTMLElement | null;
    float: HTMLElement | null;
  };
  spotOf: (id: string) => ToolPosition;
  setSpot: (id: string, spot: ToolPosition) => void;
};

export const DockContext = React.createContext<Dock | null>(null);

/** Where the app shell wants the tool buttons (its masthead); null draws them above the page. */
export const LauncherSlotContext = React.createContext<HTMLElement | null>(
  null,
);
