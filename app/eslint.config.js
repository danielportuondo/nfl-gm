import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'public', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Determinism (HANDOFF §6.3): engine randomness only through engine/rng.
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use engine/rng (seeded) instead of Math.random.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Engine must be deterministic; no wall-clock reads.',
        },
      ],
    },
  },
  {
    // Truth isolation (HANDOFF §6.1): the UI never sees a player's real future.
    files: ['src/screens/**/*.{ts,tsx}', 'src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/truth*', '**/engine/**/truth*', '**/*Truth*'],
              message: 'UI must never import truth modules. Use ScoutingView (consensus) instead.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { property: 'truth', message: 'UI must never read LeagueState.truth. Use state.scouting.' },
      ],
    },
  },
)
