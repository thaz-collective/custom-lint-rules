import { defineRule, type ESTree } from '@oxlint/plugins';

interface Options {
  checkKeyReference?: boolean; // verify queryKey actually calls the key factory
  checkParams?: boolean; // verify declared params appear in the queryKey
}

const QUERY_OPTIONS_SUFFIX = 'QueryOptions';

// Covers both object-literal properties (`{ foo: 1 }`, key type "Property")
// and destructured binding properties (`({ foo }) => ...`, also type
// "Property") - both share the same key/computed shape.
type NamedProperty = ESTree.BindingProperty | ESTree.BindingRestElement | ESTree.ObjectPropertyKind;

// Reads a property's static name, or null for spreads/rest/computed keys.
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

// Same three call shapes as options-factory-shape.ts:
//   a) direct call, b) arrow with expression body, c) arrow/fn with block body + return.
function findProducedCall(value: ESTree.Expression): ESTree.CallExpression | null {
  if (value.type === 'CallExpression') {
    return value;
  }

  if (value.type !== 'ArrowFunctionExpression' && value.type !== 'FunctionExpression') {
    return null;
  }

  const body = value.body;

  if (body === null || body.type === 'BlockStatement') {
    for (const statement of body?.body ?? []) {
      if (statement.type === 'ReturnStatement' && statement.argument?.type === 'CallExpression') {
        return statement.argument;
      }
    }

    return null;
  }

  return body.type === 'CallExpression' ? body : null;
}

// Does `node` (a queryKey value, or one of its array elements) contain a call
// to the sibling key factory, e.g. `[postOptions.getPosts()]` or `[getPosts()]`?
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
    const callee = node.callee;

    if (callee.type === 'Identifier') {
      return callee.name === factoryName;
    }

    if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
      return callee.property.name === factoryName;
    }
  }

  return false;
}

// Collects every identifier name appearing anywhere inside `node`, so we can
// tell whether a declared param made it into the queryKey. Deliberately
// untyped/generic (rather than walking a typed AST shape) since it needs to
// recurse into arbitrary expression shapes without a case for each one.
function collectIdentifierNames(node: unknown, into: Set<string>): void {
  if (!node || typeof node !== 'object') {
    return;
  }

  const record = node as Record<string, unknown>;

  if (typeof record['type'] !== 'string') {
    return;
  }

  if (record['type'] === 'Identifier' && typeof record['name'] === 'string') {
    into.add(record['name']);
  }

  for (const key of Object.keys(record)) {
    // Avoid walking back up the tree into siblings/ancestors.
    if (key === 'parent') {
      continue;
    }

    const child = record[key];

    if (Array.isArray(child)) {
      child.forEach((item) => collectIdentifierNames(item, into));
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
  // Purely structural - no per-file import/path state, so plain `create`
  // (called fresh per file) is all that's needed.
  create(context) {
    const { checkKeyReference = true, checkParams = true } = (context.options[0] ?? {}) as unknown as Options;

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

          const call = findProducedCall(prop.value);
          let calleeName: null | string = null;

          if (call) {
            const callee = call.callee;

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

          const configArg = call.arguments[0];

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
            const firstParam = prop.value.params[0];

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
