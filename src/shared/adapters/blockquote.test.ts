import { describe, it, expect } from 'vitest';
import { prependBlockquote } from './blockquote.js';

describe('prependBlockquote', () => {
  it('prefixes each line of the quote with "> " and separates body with a blank line', () => {
    expect(prependBlockquote('hello\nworld', 'reply')).toBe('> hello\n> world\n\nreply');
  });

  it('handles single-line quotes', () => {
    expect(prependBlockquote('hello', 'reply')).toBe('> hello\n\nreply');
  });

  it('handles multi-line replies', () => {
    expect(prependBlockquote('q', 'a\nb')).toBe('> q\n\na\nb');
  });
});
