import { defineRule } from '@oxlint/plugins';

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
  // `createOnce` builds this visitor ONE time for the whole run, not fresh
  // per file - so the import-tracking state below (which local names resolve
  // to a target hook, which name is bound to a `* as` import) can't just be
  // initialized here once and left alone; it has to be reset in `before`,
  // which DOES run once per file, or bindings from an earlier file would
  // leak into every file after it.
  createOnce(context) {
    const [rawOptions] = context.options;
    let requireFactoryCall = true;

    // `rawOptions` is a JsonValue (object | array | string | number | boolean
    // | null); narrowing it down to "a plain options object" via typeof/
    // Array.isArray checks (rather than an `as` cast) keeps this type-safe -
    // TS narrows it to JsonObject on its own once the other branches are ruled out.
    // Rule options are fixed for the whole run, so (unlike the state below)
    // this only needs to be parsed once, here.
    if (typeof rawOptions === 'object' && rawOptions !== null && !Array.isArray(rawOptions)) {
      const value = rawOptions['requireFactoryCall'];

      if (typeof value === 'boolean') {
        requireFactoryCall = value;
      }
    }

    // local import name -> real hook name, e.g. `uq` -> `useQuery` for
    // `import { useQuery as uq } from '@tanstack/react-query'`.
    // Reassigned per file inside `before`.
    let localHookNames = new Map<string, string>();
    // Local name bound to `import * as rq from '@tanstack/react-query'`, if any.
    // Reassigned per file inside `before`.
    let namespaceLocalName: null | string = null;

    return {
      before() {
        localHookNames = new Map();
        namespaceLocalName = null;
      },

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

          let importedName: string;

          if (specifier.imported.type === 'Identifier') {
            importedName = specifier.imported.name;
          } else {
            importedName = specifier.imported.value;
          }

          if (TARGET_HOOKS.has(importedName)) {
            localHookNames.set(specifier.local.name, importedName);
          }
        }
      },

      CallExpression(node) {
        const { callee } = node;

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

        const [firstArg] = node.arguments;

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
