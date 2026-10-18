import tseslint from '@typescript-eslint/parser';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Mirrors the jsx-a11y rules SonarCloud's accessibility findings map to:
//   S6848 -> no-static-element-interactions
//   S6845 -> no-noninteractive-tabindex
//   S6852 -> interactive-supports-focus
//   S6853 -> label-has-associated-control
//   S6825 -> no-aria-hidden-on-focusable
//   S9379 -> no-autofocus
// allowExpressionValues matches Sonar, which resolves a role written as a
// ternary between two literals instead of treating it as unknown.
// ignoreNonDOM matches Sonar too: it only grades real DOM elements, so a
// custom <SearchInput autoFocus> is not a finding there and must not be here.
const config = [
  {
    files: ['**/*.tsx'],
    languageOptions: { parser: tseslint, parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: 2022, sourceType: 'module' } },
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      'jsx-a11y/no-static-element-interactions': ['error', { allowExpressionValues: true }],
      'jsx-a11y/no-noninteractive-tabindex': ['error', { allowExpressionValues: true }],
      'jsx-a11y/interactive-supports-focus': ['error', { allowExpressionValues: true }],
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/no-aria-hidden-on-focusable': 'error',
      'jsx-a11y/no-autofocus': ['error', { ignoreNonDOM: true }],
    },
  },
];

export default config;
