import type { Preview } from '@storybook/react-vite';
import { createElement, useEffect } from 'react';

import '@oxidal/design-system/styles/index.css';

/** The four display modes the product ships; the toolbar switches them. */
const DISPLAYS = ['default', 'stage', 'sunlight', 'epaper'] as const;

const preview: Preview = {
  globalTypes: {
    display: {
      description: 'Display mode (Settings › Display)',
      toolbar: {
        title: 'Display',
        icon: 'contrast',
        items: DISPLAYS.map((value) => ({
          value,
          title: {
            default: 'Default',
            stage: 'Night',
            sunlight: 'Sunlight',
            epaper: 'E-paper',
          }[value],
        })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { display: 'default' },
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    viewport: {
      options: {
        iphone16: {
          name: 'iPhone 16',
          styles: { width: '393px', height: '852px' },
        },
        iphoneXr: {
          name: 'iPhone XR',
          styles: { width: '414px', height: '896px' },
        },
        foldCover: {
          name: 'Galaxy Z Fold 4, cover',
          styles: { width: '344px', height: '882px' },
        },
        foldInner: {
          // About the unfolded inner screen; check on the device.
          name: 'Galaxy Z Fold 4, open',
          styles: { width: '882px', height: '1104px' },
        },
        boox: {
          name: 'BOOX (portrait)',
          styles: { width: '768px', height: '1024px' },
        },
        laptop: {
          name: 'Laptop',
          styles: { width: '1280px', height: '800px' },
        },
      },
    },
  },
  decorators: [
    (Story, context) => {
      const display = String(context.globals.display ?? 'default');
      useEffect(() => {
        if (display === 'default')
          delete document.documentElement.dataset.display;
        else document.documentElement.dataset.display = display;
      }, [display]);
      return createElement(Story);
    },
  ],
};

export default preview;
