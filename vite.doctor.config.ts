import { defineConfig } from 'vite';

/** Builds the standalone doctor-viewer runtime as one IIFE script (embedded in exported HTML files). */
export default defineConfig({
  build: {
    outDir: 'dist-doctor',
    emptyOutDir: true,
    lib: { entry: 'src/doctor/runtime.ts', formats: ['iife'], name: 'SmileCraftDoctorViewer', fileName: () => 'runtime.js' },
    minify: true,
  },
});
