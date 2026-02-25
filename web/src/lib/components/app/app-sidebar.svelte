<script lang="ts">
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import { MessageSquare } from 'lucide-svelte';

  let { chats, currentPath = '/', collapsible = 'offcanvas' } = $props<{ chats: string[], currentPath?: string, collapsible?: 'none' | 'icon' | 'offcanvas' }>();
</script>

<Sidebar.Root {collapsible}>
  <Sidebar.Header>
    <div class="flex items-center gap-2 p-2 px-4 text-lg font-semibold tracking-tight">
      <MessageSquare class="w-5 h-5" />
      Clawmini
    </div>
  </Sidebar.Header>
  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.GroupLabel>Chats</Sidebar.GroupLabel>
      <Sidebar.GroupContent>
        <Sidebar.Menu>
          {#each chats as chat}
            <Sidebar.MenuItem>
              <Sidebar.MenuButton isActive={currentPath === `/chats/${chat}`}>
                {#snippet child({ props })}
                  <a href="/chats/{chat}" {...props}>
                    <MessageSquare />
                    <span data-testid="chat-link">{chat}</span>
                  </a>
                {/snippet}
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.GroupContent>
    </Sidebar.Group>
  </Sidebar.Content>
</Sidebar.Root>
