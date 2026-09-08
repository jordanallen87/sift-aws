import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Standalone Vitest config for the throwaway spikes/ directory. This directory is
// NOT a pnpm workspace member (pnpm-workspace.yaml globs only apps/* and packages/*)
// and is not one of the root vitest.config.ts's `test.projects` globs, so running
// `npx vitest run spikes/<file>` from the repo root would otherwise match zero
// projects. Passing `--config spikes/vitest.config.ts` runs this file's own
// self-contained project instead, resolving deps from spikes/node_modules (a
// standalone `npm install`, see spikes/package.json) rather than the workspace root.
const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    root: rootDir,
    include: ['*.test.ts'],
    testTimeout: 20_000,
  },
});
