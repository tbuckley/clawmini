<script lang="ts">
  import { appState } from '$lib/app-state.svelte.js';
  import MarkdownRenderer from './markdown-renderer.svelte';

  interface Props {
    content: string;
  }

  let { content }: Props = $props();
</script>

{#if appState.markdownEnabled}
  <MarkdownRenderer {content} />
{:else}
  <div class="whitespace-pre-wrap">{content}</div>
{/if}