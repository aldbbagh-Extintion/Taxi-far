// vitest for the pure core logic only (Angular unit tests still run via `ng test`).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/app/core/**/*.spec.ts'],
  },
});
