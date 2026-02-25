<script lang="ts">
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import AppSidebar from './app-sidebar.svelte';

  let { chats } = $props<{ chats: string[] }>();
</script>

<Sidebar.Provider>
  <AppSidebar {chats} collapsible="none" />
</Sidebar.Provider>
