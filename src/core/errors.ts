/** An error's message for people: Error.message, or the thrown value as text (no "Error: " prefix, no stack). */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
