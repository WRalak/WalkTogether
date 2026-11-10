import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'src/main.ts', worker: 'src/worker.ts', 'create-admin': 'scripts/create-admin.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Workspace packages are TypeScript source; bundle them into the server build.
  noExternal: [/^@walktogether\//],
});
