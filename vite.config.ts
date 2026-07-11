import { externalizeDeps } from 'vite-plugin-externalize-deps';
import { defineConfig } from 'vite-plus';

import { oxfmtConfig } from '@thaz/oxfmt-config';

export default defineConfig({
  staged: {
    '*.{js,ts,tsx}': 'vp check --fix',
  },
  run: {
    cache: {
      scripts: false,
      tasks: true,
    },
    tasks: {
      build: {
        command: 'vp pack',
      },
      check: {
        command: 'vp check',
      },
      fmt: {
        command: 'vp fmt',
      },
      typecheck: {
        command: 'vp check --no-fmt --no-lint',
      },
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [externalizeDeps()],
  pack: {
    dts: {
      build: true,
    },
    outputOptions: {
      preserveModules: true,
    },
    entry: {
      index: './src/index.ts',
    },
    exports: {
      customExports: {
        '.': {
          types: './dist/index.d.mts',
          import: './dist/index.mjs',
        },
      },
    },
  },
  fmt: oxfmtConfig,
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
