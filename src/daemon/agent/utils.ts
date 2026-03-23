export function formatPendingMessages(payloads: string[]): string {
  return payloads.map((text) => `<message>\n${text}\n</message>`).join('\n\n');
}
