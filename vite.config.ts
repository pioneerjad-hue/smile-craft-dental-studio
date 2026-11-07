import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      // Two apps: the 3D planning studio (index.html) and the doctor portal (portal.html).
      input: { studio: 'index.html', portal: 'portal.html' },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
