import { defineConfig } from "vitest/config";

// Unit, function, contract, db, static and helper self-tests. Playwright specs (tests/e2e) run with `npm run e2e`.
// knowledge/** holds worked examples with their own tests; they are not part of the project suite.
// Owned by qa-engineer (Tess) from build wave W1.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{js,mjs,ts,mts}"],
    exclude: ["knowledge/**", "node_modules/**", "tests/e2e/**", "tests/fixtures/**"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
