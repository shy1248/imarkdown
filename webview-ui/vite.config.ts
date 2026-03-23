import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/__tests__/**/*.test.ts'],
  },
  build: {
    outDir: resolve(__dirname, '..', 'dist'),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src', 'main.tsx'),
      output: {
        entryFileNames: 'webview.js',
        assetFileNames: 'webview[extname]',
        // Single chunk - no code splitting for webview
        manualChunks: undefined,
      },
    },
    // No sourcemaps for production
    sourcemap: false,
    // Minify for production
    minify: true,
    // CSP-compatible: no inline scripts/styles from Vite runtime
    cssCodeSplit: false,
  },
  // Define for browser environment
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});
