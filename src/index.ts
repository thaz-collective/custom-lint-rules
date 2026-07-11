import { eslintCompatPlugin } from '@oxlint/plugins';

import { optionsFactoryShape } from '#src/rules/options-factory-shape';
import { optionsFileLocation } from '#src/rules/options-file-location';
import { queryOptionsRequireKeyFactory } from '#src/rules/query-options-require-key-factory';
import { requireQueryOptions } from '#src/rules/require-query-options';

export const thazLintRules = eslintCompatPlugin({
  meta: {
    name: 'thaz-collective-standards',
  },
  rules: {
    'options-factory-shape': optionsFactoryShape,
    'options-file-location': optionsFileLocation,
    'query-options-require-key-factory': queryOptionsRequireKeyFactory,
    'require-query-options': requireQueryOptions,
  },
});

export default thazLintRules;
