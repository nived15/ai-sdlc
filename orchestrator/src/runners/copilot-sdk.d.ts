/**
 * Minimal type declarations for @github/copilot.
 * The CLI package is an optional peer dependency — used only by the SDK
 * review runner, which imports it dynamically and degrades gracefully when
 * it is not installed.
 */
declare module '@github/copilot' {
  export function query(params: {
    prompt: string;
    options?: Record<string, unknown>;
  }): AsyncIterable<Record<string, unknown>>;
}
