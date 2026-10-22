import { defineConfig } from 'vitest/config';
import pkg from './package.json';

export default defineConfig({
  // Mirrors vite.config.ts so tests see the same compile-time constants as the app.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    restoreMocks: true,
  },
});
