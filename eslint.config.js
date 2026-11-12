import js from '@eslint/js';
import * as figmaPlugin from '@figma/eslint-plugin-figma-plugins';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/', 'test/harness/out/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The main thread, checked with Figma's own rules for the plugin API.
    files: ['src/code.ts', 'src/main/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@figma/figma-plugins': figmaPlugin },
    rules: { ...figmaPlugin.flatConfigs.recommended.rules },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['scripts/**/*.mjs', 'test/**/*.{ts,mjs,js}', '*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
