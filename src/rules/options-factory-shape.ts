import type { ESTree } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';

const QUERY_OPTIONS_SUFFIX = 'QueryOptions';
const MUTATION_OPTIONS_SUFFIX = 'MutationOptions';

export const optionsFactoryShape = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: '*QueryOptions must be built with queryOptions(); *MutationOptions with mutationOptions().',
    },
    messages: {
      wrongFactory: "'{{name}}' must be built with {{expected}}(...) (found {{actual}}).",
    },
  },
  // Purely structural: nothing here depends on file path or import state, so
  // there's no risk of stale data leaking between files even though
  // `createOnce` only builds this visitor once for the whole run.
  createOnce(context) {
    return {
      ObjectExpression(node) {
        for (const prop of node.properties) {
          // Skip spread elements (`{ ...rest }`) - nothing to name-check.
          if (prop.type !== 'Property' || prop.computed) {
            continue;
          }

          // Reads the property's name when it's written as either
          // `{ foo: ... }` or `{ 'foo': ... }`.
          let name: null | string = null;

          if (prop.key.type === 'Identifier') {
            ({ name } = prop.key);
          } else if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') {
            // oxc follows the ESTree convention: all literals (string,
            // number, boolean, ...) share the node type "Literal" and are
            // only distinguished by the runtime type of `value`.
            name = prop.key.value;
          }

          if (name === null) {
            continue;
          }

          let expected: 'mutationOptions' | 'queryOptions';

          if (name.endsWith(QUERY_OPTIONS_SUFFIX)) {
            expected = 'queryOptions';
          } else if (name.endsWith(MUTATION_OPTIONS_SUFFIX)) {
            expected = 'mutationOptions';
          } else {
            // Doesn't match either naming convention - not ours to police.
            continue;
          }

          // The property's value can produce its queryOptions()/mutationOptions()
          // call in three shapes:
          //   a) direct call:          createPostMutationOptions: mutationOptions({ ... })
          //   b) arrow, expr body:     getPostsQueryOptions: () => queryOptions({ ... })
          //   c) arrow/fn, block body: getPostsQueryOptions: () => { return queryOptions({ ... }); }
          let call: ESTree.CallExpression | null = null;
          const { value } = prop;

          if (value.type === 'CallExpression') {
            call = value;
          } else if (value.type === 'ArrowFunctionExpression' || value.type === 'FunctionExpression') {
            const { body } = value;

            if (body?.type === 'CallExpression') {
              call = body;
            } else if (body?.type === 'BlockStatement') {
              for (const statement of body.body) {
                if (statement.type === 'ReturnStatement' && statement.argument?.type === 'CallExpression') {
                  call = statement.argument;
                  break;
                }
              }
            }
          }

          let actual = '<none>';

          if (call) {
            const { callee } = call;

            if (callee.type === 'Identifier') {
              actual = callee.name;
            } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
              actual = callee.property.name;
            }
          }

          if (actual !== expected) {
            context.report({
              node: prop.value,
              messageId: 'wrongFactory',
              data: { name, expected, actual },
            });
          }
        }
      },
    };
  },
});
