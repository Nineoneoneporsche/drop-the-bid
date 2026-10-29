import { defineConfig } from "vitest/config";

// tsconfig.json keeps `"jsx": "preserve"` for Next.js; tests that import a
// page component (tests/paymentSuccessPage.test.ts) need the JSX compiled.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
});
