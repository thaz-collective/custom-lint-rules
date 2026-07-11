import { defineRule } from '@oxlint/plugins';

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
    const rawFileName = context.filename;

    const fileName = rawFileName.replace(/\\/g, '/');

    const isAllowedLocation = fileName.includes('src/services/') && fileName.endsWith('options.ts');

    return {
      CallExpression(node) {
        const callee = node.callee;
        let calleeName: null | string = null;

        if (callee.type === 'Identifier') {
          calleeName = callee.name;
        } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          calleeName = callee.property.name;
        }

        if (calleeName !== 'queryOptions' && calleeName !== 'mutationOptions') {
          return;
        }

        if (!isAllowedLocation) {
          context.report({
            node,
            messageId: 'wrongLocation',
            data: {
              factory: calleeName,
              file: fileName,
            },
          });
        }
      },
    };
  },
});
