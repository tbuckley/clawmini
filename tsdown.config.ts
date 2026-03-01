import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli/index.ts', 'src/daemon/index.ts', 'src/cli/lite.ts'],
  format: 'esm',
  dts: true,
  clean: true,
});
