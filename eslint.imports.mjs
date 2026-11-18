import simpleImportSort from 'eslint-plugin-simple-import-sort';

/** One import layout for tooling, applications and shared packages.
 * @see docs/development.md#import-order
 */
export default {
  files: ['**/*.{js,mjs,ts,tsx}'],
  plugins: { 'simple-import-sort': simpleImportSort },
  rules: {
    'simple-import-sort/imports': [
      'error',
      {
        groups: [
          // External packages and Node built-ins, including side-effect imports.
          ['^\\u0000?(?!@oxidal/)(?:node:|@?\\w)'],
          // Shared workspace libraries.
          ['^\\u0000?@oxidal/'],
          // Relative/local modules and styles. Side-effect order is preserved.
          ['^\\u0000?\\.', '^'],
        ],
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: 'Program > :not(ImportDeclaration) ~ ImportDeclaration',
        message:
          'Keep imports above declarations so the import groups stay together.',
      },
    ],
  },
};
