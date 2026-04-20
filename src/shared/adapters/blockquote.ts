/**
 * Format `quoted` as a markdown blockquote prefixed before `body`.
 *
 * Each line of `quoted` is prefixed with `> ` and a blank line separates the
 * quote from the body so the two render as distinct blocks in markdown.
 */
export function prependBlockquote(quoted: string, body: string): string {
  const quotedContent = quoted
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `${quotedContent}\n\n${body}`;
}
