import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { config } from 'dotenv';

// Load root .env so DATABASE_URL, REDIS_URL, JWT_SECRET are available in tests
config({ path: resolve(__dirname, '../../.env') });

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    // Run test files sequentially — they share a PostgreSQL database
    // and concurrent cleanup (afterEach/afterAll) causes race conditions
    fileParallelism: false,
  },
});
