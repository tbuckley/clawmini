/**
 * Format `quoted` as a markdown blockquote prefixed before `body`.
 *
 * Each line of `quoted` is prefixed with `> `, and a blank line separates the
 * quote from the body — CommonMark requires the blank line to terminate the
 * blockquote, otherwise the body is lazily folded into it. If `sender` is
 * provided, an attribution line (`> **{sender} said:**`) is rendered as the
 * first line of the quote. Both inputs are trimmed.
 */
export function prependBlockquote(quoted: string, body: string, sender?: string): string {
  const trimmedBody = body.trim();
  const lines = quoted
    .trim()
    .split('\n')
    .map((line) => `> ${line}`);
  if (sender) {
    lines.unshift(`> **${sender} said:**`);
  }
  return `${lines.join('\n')}\n\n${trimmedBody}`;
}
