<script lang="ts">
  import { marked } from 'marked';
  import DOMPurify from 'isomorphic-dompurify';

  interface Props {
    content: string;
  }

  let { content }: Props = $props();

  let html = $derived.by(() => {
    const rawHtml = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(rawHtml);
  });
</script>

<div class="prose dark:prose-invert max-w-none break-words markdown-content" data-testid="markdown-content">
  {@html html}
</div>

<style>
  /* Ensure basic markdown styling is applied if prose classes are missing tailwind typography */
  :global(.markdown-content p) {
    margin-top: 0.5em;
    margin-bottom: 0.5em;
  }
  :global(.markdown-content pre) {
    background-color: #1e1e1e;
    color: #d4d4d4;
    padding: 1em;
    border-radius: 0.5rem;
    overflow-x: auto;
  }
  :global(.markdown-content code) {
    background-color: rgba(120, 120, 120, 0.2);
    padding: 0.2em 0.4em;
    border-radius: 0.25rem;
    font-size: 0.875em;
  }
  :global(.markdown-content pre code) {
    background-color: transparent;
    padding: 0;
  }
  :global(.markdown-content ul) {
    list-style-type: disc;
    padding-left: 1.5em;
    margin-top: 0.5em;
    margin-bottom: 0.5em;
  }
  :global(.markdown-content ol) {
    list-style-type: decimal;
    padding-left: 1.5em;
    margin-top: 0.5em;
    margin-bottom: 0.5em;
  }
</style>
