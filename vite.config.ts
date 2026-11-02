import { defineConfig } from 'vitest/config';

// Rutas relativas: el sitio vive en /ciudadanos/ dentro de GitHub Pages.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
  test: { testTimeout: 60000 },
});
