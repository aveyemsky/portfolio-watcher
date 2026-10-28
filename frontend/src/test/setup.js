// Vitest setup — extend with jest-dom matchers if available
try {
  await import('@testing-library/jest-dom');
} catch {
  // jest-dom is optional; tests that don't render React don't need it
}
