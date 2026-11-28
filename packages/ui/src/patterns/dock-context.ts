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

/**
 * Where a screen's own heading actions go when the shell shows the display
 * bar: the preset name and picker, and the action buttons. Null draws them in
 * the page, as on a phone.
 */
export type BarSlots = {
  identity: HTMLElement | null;
  actions: HTMLElement | null;
  /**
   * The floating capsule only: the parts an opened capsule shows (Tuner,
   * Save, More). Null on a phone, where they stay in the page.
   */
  extras?: HTMLElement | null;
  /** The floating capsule holds Mute and Protect itself. */
  capsule?: boolean;
};
export const BarSlotContext = React.createContext<BarSlots | null>(null);

/** A tool the dock offers, as the floating capsule's ☰ menu lists it. */
export type LauncherEntry = {
  id: string;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  toggle: () => void;
};

/**
 * Where the tool dock hands its tools when the shell lists them in a menu
 * (the floating capsule's ☰) instead of drawing its own launcher.
 */
export const ToolLauncherContext = React.createContext<
  ((entries: LauncherEntry[] | null) => void) | null
>(null);
