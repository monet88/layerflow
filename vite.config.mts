import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { uxp } from '@bubblydoo/vite-uxp-plugin';
import manifest from './manifest.json';

export default defineConfig({
  root: 'src',
  plugins: [
    react(),
    uxp(manifest),
  ],
  build: {
    sourcemap: true,
    minify: false,
    outDir: '../dist',
  },
});
