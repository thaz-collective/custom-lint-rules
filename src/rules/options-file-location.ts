import { relative } from 'node:path';

import { defineRule } from '@oxlint/plugins';

const TANSTACK_QUERY_SOURCE = '@tanstack/react-query';

const OPTIONS_FILE_PATTERN = /(?:^|\/)src\/services\/[^/]+\/options\.ts$/;

export const optionsFileLocation = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'queryOptions/mutationOptions should only be declared in a factory in src/services/<entity>/options.ts',
    },
    messages: {
      wrongLocation: '{{factory}}() may only be used in src/services/<entity>/options.ts - found in {{file}}',
    },
  },
  createOnce(context) {
    const fileName = context.filename.replace(/\\/g, '/');
    const relativeFileName = relative(context.cwd, context.filename).replace(/\\/g, '/');

    const isAllowedLocation = OPTIONS_FILE_PATTERN.test(fileName);

    if (isAllowedLocation) {
      return {};
    }

    const moduleScope = context.sourceCode.scopeManager.acquire(context.sourceCode.ast);

    return {
      CallExpression(node) {
        const callee = node.callee;
        let calleeName: null | string = null;
        let objectName: null | string = null;

        if (callee.type === 'Identifier') {
          calleeName = callee.name;
        } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          calleeName = callee.property.name;

          if (callee.object.type === 'Identifier') {
            objectName = callee.object.name;
          }
        }

        if (calleeName !== 'queryOptions' && calleeName !== 'mutationOptions') {
          return;
        }

        const variable = moduleScope?.set.get(objectName ?? calleeName);
        const importBinding = variable?.defs.find((def) => def.type === 'ImportBinding');
        const importSource =
          importBinding?.parent?.type === 'ImportDeclaration' ? importBinding.parent.source.value : null;

        if (importSource !== TANSTACK_QUERY_SOURCE) {
          return;
        }

        context.report({
          node,
          messageId: 'wrongLocation',
          data: {
            factory: calleeName,
            file: relativeFileName,
          },
        });
      },
    };
  },
});
