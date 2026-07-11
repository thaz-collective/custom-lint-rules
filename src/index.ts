import { eslintCompatPlugin } from '@oxlint/plugins';

import { optionsFileLocation } from '#src/rules/options-file-location';

export const thazLintRules = eslintCompatPlugin({
  meta: {
    name: 'thaz-collective-standards',
  },
  rules: {
    'options-file-location': optionsFileLocation,
  },
});

export default thazLintRules;
