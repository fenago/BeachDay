import { defineConfig } from "vitest/config";

// Unit and function tests only. Playwright specs (tests/e2e) run with `npm run e2e`.
// knowledge/** holds worked examples with their own tests; they are not part of the project suite.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{js,mjs,ts,mts}"],
    exclude: ["knowledge/**", "node_modules/**", "tests/e2e/**"],
  },
});
