export function handleError(action: string, err: unknown): never {
  console.error(`Failed to ${action}:`, err instanceof Error ? err.message : String(err));
  process.exit(1);
}
