import type { Credit } from '../patterns/credits';

/** The projects Oxidal is made with, for About. Logos only where we hold the file and its terms. */
export const STACK_CREDITS: Credit[] = [
  {
    role: 'Powered by',
    name: 'TONE3000',
    href: 'https://www.tone3000.com',
    logo: 'tone3000.svg',
    wordmark: true,
  },
  {
    role: 'Powered by',
    name: 'NAM',
    href: 'https://www.neuralampmodeler.com',
    logo: 'nam.png',
  },
  {
    role: 'Built with',
    name: 'Rust',
    href: 'https://www.rust-lang.org',
    logo: 'rust.svg',
    mono: true,
  },
  { role: 'Built with', name: 'React', href: 'https://react.dev' },
  { role: 'Built with', name: 'Vite', href: 'https://vite.dev' },
  { role: 'Built with', name: 'Tailwind CSS', href: 'https://tailwindcss.com' },
  { role: 'Components', name: 'shadcn/ui', href: 'https://ui.shadcn.com' },
  { role: 'Primitives', name: 'Radix', href: 'https://www.radix-ui.com' },
  { role: 'Icons by', name: 'Phosphor', href: 'https://phosphoricons.com' },
  { role: 'Shown in', name: 'Storybook', href: 'https://storybook.js.org' },
  { role: 'Plugins', name: 'LV2', href: 'https://lv2plug.in' },
  {
    role: 'Built with',
    name: 'AgenticFlowX',
    href: 'https://github.com/AgenticFlowX/afx',
    logo: 'agenticflowx.svg',
  },
];
