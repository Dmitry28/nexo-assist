// @ts-check
import eslint from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'coverage', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: { 'import-x': importX },
    settings: {
      // Resolve the `@/*` tsconfig alias so no-cycle / no-restricted-paths see through it.
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
    rules: {
      // Import hygiene — enforces the grouping/ordering the codebase already follows.
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          pathGroups: [{ pattern: '@/**', group: 'internal' }],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-duplicates': 'error',
      'import-x/no-self-import': 'error',
      // NOTE: this rule currently reports nothing — verified against a two-file cycle, both here
      // and in an isolated config, so it is the eslint/plugin combination, not our settings.
      // Kept (depth cap lifted: depth is not what makes a cycle harmful) so it starts working on
      // a plugin bump. The actual guard is src/__tests__/di-wiring.spec.ts, which explains why.
      'import-x/no-cycle': ['error', { maxDepth: '∞' }],
      'import-x/no-useless-path-segments': ['error', { noUselessIndex: true }],
      // Layering: shared infrastructure must never depend on feature modules.
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: ['./src/common', './src/config'],
              from: './src/modules',
              message:
                'common/ and config/ are shared — they must not import from feature modules.',
            },
          ],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      // 'error' explicitly — `--max-warnings 0` would promote a warning anyway.
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'interface', format: ['PascalCase'] },
        { selector: 'typeAlias', format: ['PascalCase'] },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      'no-debugger': 'error',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
