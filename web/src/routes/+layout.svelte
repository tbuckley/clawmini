<script lang="ts">
  import '../app.css';
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import { page } from '$app/state';
  import AppSidebar from '$lib/components/app/app-sidebar.svelte';

  let { data, children } = $props();
</script>

<Sidebar.Provider>
  <AppSidebar chats={data.chats} currentPath={page.url.pathname} />

  <Sidebar.Inset>
    <header class="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
      <Sidebar.Trigger />
      <div class="w-full flex justify-between">
        <div class="font-semibold text-sm">
          {#if page.url.pathname.startsWith('/chats/')}
            {page.url.pathname.replace('/chats/', '')}
          {:else}
            Home
          {/if}
        </div>
      </div>
    </header>
    <main class="flex-1 overflow-auto bg-muted/20">
      {@render children()}
    </main>
  </Sidebar.Inset>
</Sidebar.Provider>
