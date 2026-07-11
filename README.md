# [@thaz/oxlint-config](https://github.com/thaz-collective/oxlint-config)

The purpose of this project is to have a common starting point for linting configs for various projects types that thaz-collective projects use out of the box.

---

## Usage

- Install Vite+ or Oxlint and config:

  ```bash
  vp add -D vite-plus oxlint oxlint-tsgolint @thaz/oxlint-config
  ```

- Update your Vite+ config with the formatting section:

  ```ts
  import { defineConfig } from 'vite-plus';
  import { oxfmtConfig } from '@thaz/oxlint-config';

  export default defineConfig({
    // Recommended to have a staged step to run fixes
    staged: {
      '*.{js,ts,tsx}': 'vp check --fix',
    },
    run: {
      tasks: {
        // These can go in package.json or tasks depending on your preference
        check: {
          command: 'vp check',
        },
        // These can go in package.json or tasks depending on your preference
        fmt: {
          command: 'vp fmt',
        },
      },
    },
    // Config goes here. You can override parts and spread only items you want or whole config as is.
    fmt: oxfmtConfig,
  });
  ```

---

## References

- [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) - The Oxfmt library used for formatting our code
