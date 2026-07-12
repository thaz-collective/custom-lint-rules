import { relative } from 'node:path';

import type { Scope } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';

const TANSTACK_QUERY_SOURCE = '@tanstack/react-query';

// Matches ".../src/services/<entity>/options.ts" - exactly one directory
// between "services/" and the "options.ts" filename.
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
  // `createOnce` builds this visitor ONE time for the entire lint run - it is
  // NOT called again per file, it's reused across every file that gets
  // linted (that's the performance win over the plain `create` API). That
  // means anything that depends on "the current file" - its path, its
  // import bindings - can't be computed here; it has to live in mutable
  // variables that get (re)populated in the `before` hook below, which DOES
  // run once per file, right before that file's nodes are visited.
  createOnce(context) {
    // Reassigned per file inside `before`.
    let relativeFileName = '';
    let moduleScope: null | Scope = null;

    return {
      before() {
        // `context.filename` is the absolute path to the file being linted.
        // Windows uses "\" as a path separator; normalize to "/" so our
        // regex (and any string matching) works the same on every OS.
        const fileName = context.filename.replaceAll('\\', '/');
        // Convert to a path relative to the project root, purely so the
        // reported error message is short and readable instead of a full
        // absolute path.
        relativeFileName = relative(context.cwd, context.filename).replaceAll('\\', '/');

        // This file IS an allowed options.ts file - nothing to check.
        // Returning `false` tells the linter to skip this rule's visitors
        // (and the `after` hook) entirely for this file, so we don't pay
        // the cost of walking every CallExpression for nothing.
        if (OPTIONS_FILE_PATTERN.test(fileName)) {
          return false;
        }

        // The "module scope" holds every top-level binding in this file,
        // including import bindings (e.g. what `queryOptions` refers to after
        // `import { queryOptions } from '@tanstack/react-query'`). We need this
        // later to confirm a call is actually the tanstack function and not some
        // unrelated function/method that happens to share the name.
        moduleScope = context.sourceCode.scopeManager.acquire(context.sourceCode.ast);

        return true;
      },

      // Called for every function-call node - but only in files that made it
      // past `before` above, i.e. files that AREN'T an allowed options.ts.
      CallExpression(node) {
        const { callee } = node;
        // calleeName is the *function name itself* being called, regardless
        // of how it was called:
        //   queryOptions()        -> callee is an Identifier -> calleeName = "queryOptions"
        //   rq.queryOptions()     -> callee is a MemberExpression -> calleeName = "queryOptions" (the ".property")
        let calleeName: null | string = null;
        // objectName is only set for the second form above: it's the thing
        // *before* the dot (`rq` in `rq.queryOptions()`). We need it because
        // when queryOptions is called as a method off a namespace import
        // (`import * as rq from '@tanstack/react-query'`), it's `rq` - not
        // `queryOptions` - that's bound to the import we need to verify.
        let objectName: null | string = null;

        if (callee.type === 'Identifier') {
          calleeName = callee.name;
        } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          calleeName = callee.property.name;

          if (callee.object.type === 'Identifier') {
            objectName = callee.object.name;
          }
        }

        // Not a call shaped like `foo()` or `foo.bar()` at all - nothing to check.
        if (calleeName === null) {
          return;
        }

        // Look up whichever name is actually the import binding we care
        // about: `objectName` for `rq.queryOptions()`, otherwise
        // `calleeName` for a plain `someLocalName()` call. Note we can't
        // pre-filter by name here the way we used to - a named import can be
        // renamed (`import { queryOptions as tqQueryOptions } ...`), so the
        // local name alone can't tell us whether this is the function we
        // care about. We only find that out once we resolve the import below.
        const variable = moduleScope?.set.get(objectName ?? calleeName);
        // A variable can have multiple "definitions" (e.g. reassigned), so
        // find the one that came from an import statement, if any.
        const importBinding = variable?.defs.find((def) => def.type === 'ImportBinding');

        if (!importBinding || importBinding.parent?.type !== 'ImportDeclaration') {
          return;
        }

        // Not imported from tanstack query at all - don't flag it, regardless
        // of what it's named.
        if (importBinding.parent.source.value !== TANSTACK_QUERY_SOURCE) {
          return;
        }

        // Figure out the *real* (un-aliased) export name:
        //  - `rq.queryOptions()`: property access can't be renamed, so
        //    `calleeName` ("queryOptions") is already the real export name.
        //  - `tqQueryOptions()` from `{ queryOptions as tqQueryOptions }`:
        //    the local name is an alias - the specifier's `imported` field
        //    holds the name it was actually exported as.
        let importedName = calleeName;

        if (objectName === null && importBinding.node.type === 'ImportSpecifier') {
          if (importBinding.node.imported.type === 'Identifier') {
            importedName = importBinding.node.imported.name;
          } else {
            importedName = importBinding.node.imported.value;
          }
        }

        if (importedName !== 'queryOptions' && importedName !== 'mutationOptions') {
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
