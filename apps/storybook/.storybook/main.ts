import type { StorybookConfig } from '@storybook/react-vite';
import remarkGfm from 'remark-gfm';

const config: StorybookConfig = {
  stories: [
    '../guide/*.mdx',
    '../baseline/*.stories.@(ts|tsx)',
    '../../../packages/ui/src/**/*.stories.@(ts|tsx)',
  ],
  addons: [
    {
      // Tables in the guide pages need GitHub-flavoured Markdown.
      name: '@storybook/addon-docs',
      options: {
        mdxPluginOptions: { mdxCompileOptions: { remarkPlugins: [remarkGfm] } },
      },
    },
    '@storybook/addon-a11y',
    '@storybook/addon-vitest',
  ],
  framework: { name: '@storybook/react-vite', options: {} },
  staticDirs: ['../../../packages/ui/public'],
  core: { disableTelemetry: true },
};

export default config;
