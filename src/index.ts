import { definePlugin } from '@oxlint/plugins';

import { optionsFileLocation } from '#src/rules/options-file-location';

export const thazLintRules = definePlugin({
  meta: {
    name: 'thaz-collective-standards',
  },
  rules: {
    'options-file-location': optionsFileLocation,
  },
});
