# [@thaz/custom-lint-rules](https://github.com/thaz-collective/custom-lint-rules)

Custom Oxlint rules for thaz-collective applications and libraries, distributed as an Oxlint JS plugin.

---

## Usage

- Install Vite+ (or Oxlint directly) and this package:

  ```bash
  vp add -D vite-plus oxlint oxlint-tsgolint @thaz/custom-lint-rules
  ```

- Register the plugin under the `lint.jsPlugins` array in your Vite+ config, then turn on whichever rules you want under `lint.rules`. Rule IDs are prefixed with the plugin's name, `thaz-collective-standards`:

  ```ts
  import { defineConfig } from 'vite-plus';

  export default defineConfig({
    run: {
      tasks: {
        lint: {
          command: 'vp lint',
        },
      },
    },
    lint: {
      jsPlugins: ['@thaz/custom-lint-rules'],
      rules: {
        'thaz-collective-standards/options-file-location': 'error',
        'thaz-collective-standards/options-factory-shape': 'error',
        'thaz-collective-standards/require-query-options': 'error',
        'thaz-collective-standards/query-options-require-key-factory': 'error',
      },
    },
  });
  ```

  If you'd rather configure Oxlint directly (no Vite+), add the same shape to your `.oxlintrc.json`:

  ```json
  {
    "jsPlugins": ["@thaz/custom-lint-rules"],
    "rules": {
      "thaz-collective-standards/options-file-location": "error"
    }
  }
  ```

  Since `@thaz/custom-lint-rules` is a plain package specifier here, Oxlint resolves it through normal Node module resolution - no relative path needed. If you want the rules under a different prefix, use the aliased form instead:

  ```ts
  const lint = {
    jsPlugins: [{ name: 'thaz', specifier: '@thaz/custom-lint-rules' }],
    rules: {
      'thaz/options-file-location': 'error',
    },
  };
  ```

  > JS plugins are an Oxlint alpha feature and not yet subject to semver - see the [Oxlint JS plugins docs](https://oxc.rs/docs/guide/usage/linter/js-plugins.html).

---

## Rules

| Rule                                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options-file-location`             | Restricts `queryOptions()`/`mutationOptions()` (from `@tanstack/react-query`) to only be called inside a factory file at `src/services/<entity>/options.ts`, so query/mutation option definitions live in one predictable place per entity.                                                                                                                                                                                                                                                         |
| `options-factory-shape`             | Within an options-factory object, requires any property ending in `QueryOptions` to be built with `queryOptions(...)` and any property ending in `MutationOptions` to be built with `mutationOptions(...)` - catches copy/paste mistakes where the wrong factory function was used.                                                                                                                                                                                                                 |
| `require-query-options`             | Requires `useQuery`/`useSuspenseQuery` to be called with a queryOptions factory call (e.g. `postOptions.getPostsQueryOptions()`) rather than an inline object literal, keeping query configuration centralized in the options factory instead of scattered across components. Accepts a `requireFactoryCall` option (default `true`) that, when set to `false`, also tolerates a bare variable/expression as the argument instead of requiring a call.                                              |
| `query-options-require-key-factory` | For every `*QueryOptions` property, requires a sibling key-factory property with the matching base name (e.g. `getPostsQueryOptions` needs a sibling `getPosts`), and verifies the `queryOptions()` call's `queryKey` actually references that sibling factory. Accepts `checkKeyReference` (default `true`) to toggle the queryKey-reference check, and `checkParams` (default `true`) to also verify that any parameters the key factory declares are included somewhere in the `queryKey` array. |

All four rules are defined with Oxlint's native `createOnce` API (see each rule's source for details on how per-file state is handled) and are exported from a single plugin, `thaz-collective-standards`, via `@oxlint/plugins`' `eslintCompatPlugin`.

---

## References

- [Oxlint JS Plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html) - how Oxlint loads and runs JS-based plugins like this one
- [`@oxlint/plugins`](https://www.npmjs.com/package/@oxlint/plugins) - the API (`defineRule`, `definePlugin`, `eslintCompatPlugin`) used to author these rules
- [TanStack Query](https://tanstack.com/query/latest) - the library these rules enforce conventions around
