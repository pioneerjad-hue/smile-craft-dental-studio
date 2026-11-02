import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** Standalone Simulation Viewer Builder as one offline HTML file. */
export default defineConfig({
  plugins: [viteSingleFile()],
  base: './',
  build: { outDir: 'dist-builder', emptyOutDir: true, rollupOptions: { input: 'viewer-builder.html' } },
});
