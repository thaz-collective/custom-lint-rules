import { defineRule } from '@oxlint/plugins';

interface Options {
  // When false, a bare identifier/variable is tolerated; only inline object
  // literals are flagged.
  requireFactoryCall?: boolean;
}

const TANSTACK_QUERY_SOURCE = '@tanstack/react-query';
const TARGET_HOOKS = new Set(['useQuery', 'useSuspenseQuery']);

export const requireQueryOptions = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Require useQuery/useSuspenseQuery to receive a queryOptions factory call, not an inline object.',
    },
    messages: {
      inlineObject:
        'Pass a queryOptions factory call to {{hook}}() (e.g. postOptions.getPostsQueryOptions()), not an inline object.',
      notAFactoryCall:
        'The first argument to {{hook}}() must be a call to a queryOptions factory (e.g. postOptions.getPostsQueryOptions()).',
      missingArgument: '{{hook}}() must be called with a queryOptions factory call.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          requireFactoryCall: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
  },
  // Stateful (tracks imports seen so far in the file) but the state only
  // needs to live for the duration of one file, and `create` is called fresh
  // per file, so a plain closure-scoped Map is naturally reset for us -
  // no `createOnce`/`before` dance required here.
  create(context) {
    const { requireFactoryCall = true } = (context.options[0] ?? {}) as unknown as Options;

    // local import name -> real hook name, e.g. `uq` -> `useQuery` for
    // `import { useQuery as uq } from '@tanstack/react-query'`.
    const localHookNames = new Map<string, string>();
    // Local name bound to `import * as rq from '@tanstack/react-query'`, if any.
    let namespaceLocalName: null | string = null;

    return {
      ImportDeclaration(node) {
        if (node.source.value !== TANSTACK_QUERY_SOURCE) {
          return;
        }

        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') {
            namespaceLocalName = specifier.local.name;
            continue;
          }

          if (specifier.type !== 'ImportSpecifier') {
            continue;
          }

          const importedName =
            specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value;

          if (TARGET_HOOKS.has(importedName)) {
            localHookNames.set(specifier.local.name, importedName);
          }
        }
      },

      CallExpression(node) {
        const callee = node.callee;

        // Resolve which hook (if any) is being called, requiring it to
        // actually trace back to an import from @tanstack/react-query -
        // an unrelated `useQuery` from elsewhere isn't ours to police.
        let hookName: null | string = null;

        if (callee.type === 'Identifier') {
          hookName = localHookNames.get(callee.name) ?? null;
        } else if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === namespaceLocalName &&
          TARGET_HOOKS.has(callee.property.name)
        ) {
          hookName = callee.property.name;
        }

        if (hookName === null) {
          return;
        }

        const firstArg = node.arguments[0];

        if (!firstArg) {
          context.report({ node, messageId: 'missingArgument', data: { hook: hookName } });
          return;
        }

        // The thing we're guarding against: an inlined config object.
        if (firstArg.type === 'ObjectExpression') {
          context.report({ node: firstArg, messageId: 'inlineObject', data: { hook: hookName } });
          return;
        }

        // Optionally require it to be a call (rejects bare variables / spreads).
        if (requireFactoryCall && firstArg.type !== 'CallExpression') {
          context.report({ node: firstArg, messageId: 'notAFactoryCall', data: { hook: hookName } });
        }
      },
    };
  },
});
