import js from '@eslint/js';
import globals from 'globals';
export default [
  js.configs.recommended,
  {
    files: ['scripts/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node },
  },
];
