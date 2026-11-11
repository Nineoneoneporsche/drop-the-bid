import { defineConfig } from "vitest/config";

// tsconfig.json keeps `"jsx": "preserve"` for Next.js; tests that import a
// page component (tests/paymentSuccessPage.test.ts) need the JSX compiled.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  // The payment suites exercise the (dormant) Toss integration, so they run
  // with it switched on; tests/paymentProvider.test.ts covers the "none"
  // default that Production builds get.
  test: { env: { NEXT_PUBLIC_PAYMENT_PROVIDER: "toss" } },
});
