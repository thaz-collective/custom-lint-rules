import { defineRule, type ESTree } from '@oxlint/plugins';

const QUERY_OPTIONS_SUFFIX = 'QueryOptions';
const MUTATION_OPTIONS_SUFFIX = 'MutationOptions';

// Reads a property's name when it's written as either `{ foo: ... }` or
// `{ 'foo': ... }`. Returns null for computed keys (`{ [x]: ... }`), since
// there's no static name to check.
function getStaticPropertyName(prop: ESTree.ObjectProperty): null | string {
  if (prop.computed) {
    return null;
  }

  if (prop.key.type === 'Identifier') {
    return prop.key.name;
  }

  // oxc follows the ESTree convention: all literals (string, number,
  // boolean, ...) share the node type "Literal" and are only distinguished
  // by the runtime type of `value`.
  if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') {
    return prop.key.value;
  }

  return null;
}

// A property's value can produce its queryOptions()/mutationOptions() call in
// three shapes:
//   a) direct call:        createPostMutationOptions: mutationOptions({ ... })
//   b) arrow, expr body:   getPostsQueryOptions: () => queryOptions({ ... })
//   c) arrow/fn, block body: getPostsQueryOptions: () => { return queryOptions({ ... }); }
function findProducedCall(value: ESTree.Expression): ESTree.CallExpression | null {
  if (value.type === 'CallExpression') {
    return value;
  }

  if (value.type !== 'ArrowFunctionExpression' && value.type !== 'FunctionExpression') {
    return null;
  }

  const body = value.body;

  if (body === null) {
    return null;
  }

  if (body.type === 'CallExpression') {
    return body;
  }

  // Anything else is an arrow with a concise, non-call body (`() => x + 1`)
  // - nothing for us to unwrap.
  if (body.type !== 'BlockStatement') {
    return null;
  }

  for (const statement of body.body) {
    if (statement.type === 'ReturnStatement' && statement.argument?.type === 'CallExpression') {
      return statement.argument;
    }
  }

  return null;
}

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
  // there's no risk of stale data leaking between files - plain `create`
  // (called fresh per file) is simpler than `createOnce` and there's no
  // per-file setup worth optimizing away.
  create(context) {
    return {
      ObjectExpression(node) {
        for (const prop of node.properties) {
          // Skip spread elements (`{ ...rest }`) - nothing to name-check.
          if (prop.type !== 'Property') {
            continue;
          }

          const name = getStaticPropertyName(prop);

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

          const call = findProducedCall(prop.value);

          let actual = '<none>';

          if (call) {
            const callee = call.callee;

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
