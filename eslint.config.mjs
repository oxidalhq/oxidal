import js from '@eslint/js';
import globals from 'globals';

import importOrder from './eslint.imports.mjs';
export default [
  js.configs.recommended,
  importOrder,
  {
    files: ['scripts/**/*.mjs', 'eslint.config.mjs', 'eslint.imports.mjs'],
    languageOptions: { globals: globals.node },
  },
];
