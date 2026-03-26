import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import MarkdownRenderer from './markdown-renderer.svelte';

describe('MarkdownRenderer', () => {
  it('renders standard text inside a paragraph element', () => {
    render(MarkdownRenderer, { content: 'Hello world' });
    const p = screen.getByText('Hello world');
    expect(p.tagName).toBe('P');
  });

  it('renders markdown to html properly', () => {
    render(MarkdownRenderer, { content: '# Heading 1\n\n**Bold text**' });

    const heading = screen.getByText('Heading 1');
    expect(heading.tagName).toBe('H1');

    const bold = screen.getByText('Bold text');
    expect(bold.tagName).toBe('STRONG');
  });

  it('sanitizes script tags for XSS protection', () => {
    const { container } = render(MarkdownRenderer, {
      content: '<script>alert("xss")</script>This is safe',
    });

    // The script should be stripped out.
    // The content might just have "This is safe" left.
    const markdownContent = container.querySelector(
      '[data-testid="markdown-content"]'
    ) as HTMLElement;
    expect(markdownContent.innerHTML).not.toContain('<script>');
    expect(markdownContent.innerHTML).toContain('This is safe');
  });

  it('sanitizes onclick attributes for XSS protection', () => {
    render(MarkdownRenderer, { content: '[Click me](javascript:alert("xss"))' });

    const link = screen.getByText('Click me') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    // isomorphic-dompurify should neutralize javascript: URLs by default (often stripping href or replacing it)
    expect(link.href).not.toContain('javascript:');
  });
});
