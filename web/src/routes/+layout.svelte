<script lang="ts">
  import '../app.css';
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import { page } from '$app/state';
  import AppSidebar from '$lib/components/app/app-sidebar.svelte';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { appState } from '$lib/app-state.svelte.js';
  import { Settings } from 'lucide-svelte';

  let { data, children } = $props();

  let debugProxy = $state(appState.verbosityLevel !== 'default');
  $effect(() => {
    appState.verbosityLevel = debugProxy ? 'verbose' : 'default';
  });
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
            <label for="debug-toggle" class="text-sm text-muted-foreground font-medium cursor-pointer">
              Debug view
            </label>
            <Switch id="debug-toggle" bind:checked={debugProxy} />
          </div>
        </div>
      </div>
    </header>
    <main class="flex flex-1 flex-col overflow-hidden bg-muted/20">
      {@render children()}
    </main>
  </Sidebar.Inset>
</Sidebar.Provider>
