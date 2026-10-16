import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/tests/load/results/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    // Plain JS config files are not part of any tsconfig project, so type-aware
    // rules cannot run on them. disableTypeChecked supplies both the off-switch
    // for those rules and the parserOptions that stop type information being
    // requested. Its languageOptions is merged rather than replaced, so the
    // globals set here survive.
    ...tseslint.configs.disableTypeChecked,
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { ...globals.node },
    },
  },

  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },

  {
    // Migrations, seeds, and test bootstrap run as one-shot scripts. A hard exit
    // at the end of every file is noise there, and console output is the point.
    files: ['db/**/*.ts', 'server/tests/global-setup.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Supertest types a parsed response body as `any`, and asserting on that
      // body is the entire purpose of an API test. Narrowing it per assertion
      // would add ceremony without adding safety.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  prettier,
);
