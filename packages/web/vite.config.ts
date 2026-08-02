import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2023' },
  publicDir: 'public',
  server: {
    // En desarrollo el cliente habla con el servidor local de Vera.
    proxy: Object.fromEntries(
      ['/operations', '/pages', '/search', '/graph', '/ops', '/health', '/invariants'].map((p) => [
        p,
        { target: 'http://localhost:4173', changeOrigin: true },
      ]),
    ),
  },
});
