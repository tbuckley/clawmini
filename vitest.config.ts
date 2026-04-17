import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}', 'e2e/**/*.{test,spec}.{js,ts}'],
    exclude: ['web/**', 'node_modules/**', 'dist/**'],
    globalSetup: ['e2e/_helpers/global-setup.ts'],
  },
});
