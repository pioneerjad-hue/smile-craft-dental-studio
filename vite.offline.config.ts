import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** Offline build: everything (code, styles) inlined into one HTML file that opens with a double-click. */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: { outDir: 'dist-offline', emptyOutDir: true },
});
