import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'REACT_APP_'],
  // The CRA codebase uses both .js and .jsx files containing JSX.
  esbuild: { loader: 'jsx', include: /src\/.*\.jsx?$/, exclude: [] },
  server: {
    proxy: { '/api': 'http://localhost:5000' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
    clearMocks: true,
  },
});
