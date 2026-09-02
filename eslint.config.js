import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

const ignoredWorkspacePaths = [
  'dist',
  'release-bin',
  'node_modules',
  '.references',
  '.rendered-pages-*',
  '.session-inspection-*',
  '.satellite-*',
  '.tmp-*',
  '.api-crawl*',
  '.crawl*',
  '.post-api*',
  '.preview-*',
  '.codex-*',
  'coverage',
  'test-results',
]

export default tseslint.config(
  { ignores: ignoredWorkspacePaths },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['**/*.{mjs,js}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    // shadcn exports component helpers such as buttonVariants beside components.
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
