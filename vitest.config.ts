import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['web/**', 'node_modules/**', 'dist/**'],
    globalSetup: ['src/cli/e2e/global-setup.ts'],
  },
});
