import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Software conversion in tests, whatever graphics chip the machine running them has.
    env: { VV_HWACCEL: 'none' }
  }
});
