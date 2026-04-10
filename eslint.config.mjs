import hmppsConfig from '@ministryofjustice/eslint-config-hmpps'

export default [
  ...hmppsConfig(),
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      parserOptions: {
        ecmaVersion: 'latest',
      },
    },
    rules: {
      'no-underscore-dangle': 'off',
      'no-console': 'off',
      'no-continue': 'off',
      'prefer-destructuring': 'off',
      'no-shadow': 'off',
      'prettier/prettier': 'off',
    },
  },
]
