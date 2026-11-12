// Repository-wide ESLint flat config (npm run lint). Type checking is done by `tsc` in each
// workspace; ESLint covers correctness, React hooks and security-sensitive patterns.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.expo/**',
      '**/.expo-export-check/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'mobile/android/**',
      'mobile/ios/**',
      'mobile/nativewind-env.d.ts',
      'server/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { security },
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // Security-sensitive patterns (OWASP): never eval, never build regexes or child processes from input.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-child-process': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-bidi-characters': 'error',
      // Pragmatic TypeScript defaults for this codebase.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['mobile/**/*.{ts,tsx}', 'platform-admin/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    files: ['**/*.cjs', '**/*.js', '**/*.mjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/test/**', '**/__tests__/**', 'infrastructure/loadtest/**'],
    rules: { 'no-console': 'off', 'security/detect-non-literal-regexp': 'off' },
  },
  {
    // CLI scripts print to the terminal on purpose.
    files: ['server/scripts/**', 'server/prisma/seed.ts', 'server/prisma/seed-demo.ts'],
    rules: { 'no-console': 'off' },
  },
);
