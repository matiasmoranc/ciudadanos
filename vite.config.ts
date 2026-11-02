import { defineConfig } from 'vite';

// Rutas relativas: el sitio vive en /ciudadanos/ dentro de GitHub Pages.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
});
