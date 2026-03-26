<script lang="ts">
  import '../app.css';
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import { page } from '$app/state';
  import AppSidebar from '$lib/components/app/app-sidebar.svelte';
  import { appState } from '$lib/app-state.svelte.js';
  import { Settings, MessageSquare, Bug, Terminal, Type, FileCode } from 'lucide-svelte';
  import { onMount } from 'svelte';

  let { data, children } = $props();

  onMount(() => {
    const stored = localStorage.getItem('appState.markdownEnabled');
    if (stored !== null) {
      appState.markdownEnabled = stored === 'true';
    }
  });

  $effect(() => {
    localStorage.setItem('appState.markdownEnabled', String(appState.markdownEnabled));
  });

  function toggleVerbosity() {
    if (appState.verbosityLevel === 'default') {
      appState.verbosityLevel = 'debug';
    } else if (appState.verbosityLevel === 'debug') {
      appState.verbosityLevel = 'verbose';
    } else {
      appState.verbosityLevel = 'default';
    }
  }

  function toggleMarkdown() {
    appState.markdownEnabled = !appState.markdownEnabled;
  }
</script>

<Sidebar.Provider class="h-[100dvh] overflow-hidden">
  <AppSidebar chats={data.chats} agents={data.agents} currentPath={page.url.pathname} />

  <Sidebar.Inset>
    <header class="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
      <Sidebar.Trigger />
      <div class="w-full flex items-center justify-between">
        <div class="font-semibold text-sm">
          {#if page.url.pathname.startsWith('/chats/')}
            {page.url.pathname.replace('/chats/', '').replace('/settings', '')}
          {:else}
            Home
          {/if}
        </div>
        <div class="flex items-center gap-4">
          {#if page.url.pathname.startsWith('/chats/') && !page.url.pathname.endsWith('/settings')}
            <a href="{page.url.pathname}/settings" class="text-muted-foreground hover:text-foreground transition-colors" title="Chat Settings">
              <Settings class="w-5 h-5" />
            </a>
          {/if}
          <div class="flex items-center gap-2">
            <button
              id="markdown-toggle"
              type="button"
              class="flex items-center justify-center p-2 rounded-md hover:bg-muted transition-colors"
              aria-label={`Markdown ${appState.markdownEnabled ? 'enabled' : 'disabled'}`}
              onclick={toggleMarkdown}
              title={`Markdown: ${appState.markdownEnabled ? 'On' : 'Off'}`}
            >
              {#if appState.markdownEnabled}
                <FileCode class="w-5 h-5 text-muted-foreground" />
              {:else}
                <Type class="w-5 h-5 text-muted-foreground" />
              {/if}
            </button>
            <button
              id="verbosity-toggle"
              type="button"
              class="flex items-center justify-center p-2 rounded-md hover:bg-muted transition-colors"
              aria-label={`Verbosity level: ${appState.verbosityLevel}`}
              onclick={toggleVerbosity}
              title={`Verbosity: ${appState.verbosityLevel}`}
            >
              {#if appState.verbosityLevel === 'default'}
                <MessageSquare class="w-5 h-5 text-muted-foreground" />
              {:else if appState.verbosityLevel === 'debug'}
                <Bug class="w-5 h-5 text-amber-500" />
              {:else if appState.verbosityLevel === 'verbose'}
                <Terminal class="w-5 h-5 text-red-500" />
              {/if}
            </button>
          </div>
        </div>
      </div>
    </header>
    <main class="flex flex-1 flex-col overflow-hidden bg-muted/20">
      {@render children()}
    </main>
  </Sidebar.Inset>
</Sidebar.Provider>
