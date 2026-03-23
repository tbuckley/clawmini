export function formatPendingMessages(payloads: string[]): string {
  return payloads.map((text) => `<message>\n${text}\n</message>`).join('\n\n');
}

export function isNewSession(env: Record<string, string>): boolean {
  return env['SESSION_ID'] === undefined;
}
