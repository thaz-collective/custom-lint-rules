import type { ESTree } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';

const QUERY_OPTIONS_SUFFIX = 'QueryOptions';

// Covers both object-literal properties (`{ foo: 1 }`, key type "Property")
// and destructured binding properties (`({ foo }) => ...`, also type
// "Property") - both share the same key/computed shape.
type NamedProperty = ESTree.BindingProperty | ESTree.BindingRestElement | ESTree.ObjectPropertyKind;

// Reads a property's static name, or null for spreads/rest/computed keys.
// Called from several distinct spots below (sibling names, the main
// *QueryOptions loop, matching the queryKey property, reading destructured
// params) so it earns its keep as a real helper. It doesn't touch `context`
// or any other rule state, so it lives at module scope rather than nested in
// `createOnce` - nesting a function that captures nothing just gets it
// flagged for recreating itself needlessly.
function propName(prop: NamedProperty): null | string {
  if (prop.type !== 'Property' || prop.computed) {
    return null;
  }

  if (prop.key.type === 'Identifier') {
    return prop.key.name;
  }

  // oxc follows the ESTree convention: every literal shares node type
  // "Literal", distinguished only by the runtime type of `value`.
  if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') {
    return prop.key.value;
  }

  return null;
}

// Does `node` (a queryKey value, or one of its array elements) contain a call
// to the sibling key factory, e.g. `[postOptions.getPosts()]` or `[getPosts()]`?
// Recursive (arrays/spreads can nest), so it needs a name to call itself -
// can't be inlined at its one call site the way findProducedCall below was.
function referencesFactory(node: ESTree.Expression | ESTree.SpreadElement | null, factoryName: string): boolean {
  if (!node) {
    return false;
  }

  if (node.type === 'SpreadElement') {
    return referencesFactory(node.argument, factoryName);
  }

  if (node.type === 'ArrayExpression') {
    return node.elements.some((element) => referencesFactory(element, factoryName));
  }

  if (node.type === 'CallExpression') {
    const { callee } = node;

    if (callee.type === 'Identifier') {
      return callee.name === factoryName;
    }

    if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
      return callee.property.name === factoryName;
    }
  }

  return false;
}

// A type guard (rather than an inline `typeof`/`as` check) because narrowing
// `unknown` to a genuinely indexable `Record<string, unknown>` - as opposed
// to just `object`, which doesn't allow property access - requires a
// user-defined predicate; there's no way to inline this without an `as` cast.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Collects every identifier name appearing anywhere inside `node`, so we can
// tell whether a declared param made it into the queryKey. Deliberately
// untyped/generic (rather than walking a typed AST shape) since it needs to
// recurse into arbitrary expression shapes without a case for each one.
function collectIdentifierNames(node: unknown, into: Set<string>): void {
  if (!isRecord(node)) {
    return;
  }

  if (node['type'] === 'Identifier' && typeof node['name'] === 'string') {
    into.add(node['name']);
  }

  for (const key of Object.keys(node)) {
    // Avoid walking back up the tree into siblings/ancestors.
    if (key === 'parent') {
      continue;
    }

    const child = node[key];

    if (Array.isArray(child)) {
      for (const item of child) {
        collectIdentifierNames(item, into);
      }
    } else {
      collectIdentifierNames(child, into);
    }
  }
}

export const queryOptionsRequireKeyFactory = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Each *QueryOptions must have a sibling key factory that its queryKey references.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          checkKeyReference: { type: 'boolean' },
          checkParams: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingKeyFactory: "'{{name}}' needs a sibling key factory named '{{base}}' in the same object.",
      missingQueryKey: "'{{name}}' must return queryOptions with a queryKey.",
      keyMismatch:
        "The queryKey for '{{name}}' should reference the '{{base}}' key factory, e.g. [factory.{{base}}(), ...].",
      paramNotInKey: "'{{name}}' accepts '{{param}}' but it is not included in the queryKey.",
    },
  },
  // Purely structural - no per-file import/path state - so even though
  // `createOnce` only builds this visitor once for the whole run, nothing
  // here can go stale between files.
  createOnce(context) {
    const [rawOptions] = context.options;
    let checkKeyReference = true;
    let checkParams = true;

    // `rawOptions` is a JsonValue (object | array | string | number | boolean
    // | null); narrowing it down to "a plain options object" via typeof/
    // Array.isArray checks (rather than an `as` cast) keeps this type-safe -
    // TS narrows it to JsonObject on its own once the other branches are ruled out.
    if (typeof rawOptions === 'object' && rawOptions !== null && !Array.isArray(rawOptions)) {
      const checkKeyReferenceValue = rawOptions['checkKeyReference'];
      const checkParamsValue = rawOptions['checkParams'];

      if (typeof checkKeyReferenceValue === 'boolean') {
        checkKeyReference = checkKeyReferenceValue;
      }

      if (typeof checkParamsValue === 'boolean') {
        checkParams = checkParamsValue;
      }
    }

    return {
      // Inspect the object literal as a whole so we can see all sibling
      // properties at once (e.g. that `getPosts` lives next to
      // `getPostsQueryOptions`).
      ObjectExpression(node) {
        const siblingNames = new Set<string>();

        for (const prop of node.properties) {
          const name = propName(prop);

          if (name) {
            siblingNames.add(name);
          }
        }

        for (const prop of node.properties) {
          if (prop.type !== 'Property') {
            continue;
          }

          const name = propName(prop);

          if (!name || !name.endsWith(QUERY_OPTIONS_SUFFIX)) {
            continue;
          }

          // getPostsQueryOptions -> getPosts
          const base = name.slice(0, -QUERY_OPTIONS_SUFFIX.length);

          if (!siblingNames.has(base)) {
            context.report({ node: prop, messageId: 'missingKeyFactory', data: { name, base } });
            continue;
          }

          if (!checkKeyReference) {
            continue;
          }

          // The property's value can produce its queryOptions() call in
          // three shapes:
          //   a) direct call:          getPostsQueryOptions: queryOptions({ ... })
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

          let calleeName: null | string = null;

          if (call) {
            const { callee } = call;

            if (callee.type === 'Identifier') {
              calleeName = callee.name;
            } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
              calleeName = callee.property.name;
            }
          }

          // Wrong factory entirely is options-factory-shape's problem - skip here.
          if (!call || calleeName !== 'queryOptions') {
            continue;
          }

          const [configArg] = call.arguments;

          if (!configArg || configArg.type !== 'ObjectExpression') {
            continue;
          }

          const queryKeyProp = configArg.properties.find((p) => propName(p) === 'queryKey');

          if (!queryKeyProp || queryKeyProp.type !== 'Property') {
            context.report({ node: call, messageId: 'missingQueryKey', data: { name } });
            continue;
          }

          const keyValue = queryKeyProp.value;

          if (!referencesFactory(keyValue, base)) {
            context.report({ node: queryKeyProp, messageId: 'keyMismatch', data: { name, base } });
          }

          if (!checkParams || keyValue.type !== 'ArrayExpression') {
            continue;
          }

          // Figure out what the factory declares as its first argument:
          // `({ params }) => ...` yields ['params']; `(x) => ...` yields ['x'].
          let declaredParams: string[] = [];

          if (prop.value.type === 'ArrowFunctionExpression' || prop.value.type === 'FunctionExpression') {
            const [firstParam] = prop.value.params;

            if (firstParam?.type === 'ObjectPattern') {
              declaredParams = firstParam.properties.map((p) => propName(p)).filter((n): n is string => n !== null);
            } else if (firstParam?.type === 'Identifier') {
              declaredParams = [firstParam.name];
            }
          }

          const identifiersInKey = new Set<string>();
          collectIdentifierNames(keyValue, identifiersInKey);

          for (const param of declaredParams) {
            if (!identifiersInKey.has(param)) {
              context.report({ node: queryKeyProp, messageId: 'paramNotInKey', data: { name, param } });
            }
          }
        }
      },
    };
  },
});
