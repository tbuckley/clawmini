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

  it('trims surrounding whitespace from quoted text and body', () => {
    expect(prependBlockquote('  hello\nworld  \n', '\n\nreply\n')).toBe(
      '> hello\n> world\n\nreply'
    );
  });

  it('renders an attribution line when sender is provided', () => {
    expect(prependBlockquote('hello\nworld', 'reply', 'Tom')).toBe(
      '> **Tom said:**\n> hello\n> world\n\nreply'
    );
  });
});
