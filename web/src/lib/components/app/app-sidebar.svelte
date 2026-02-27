<script lang="ts">
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { MessageSquare, Plus, Bot } from 'lucide-svelte';
  import { goto, invalidate } from '$app/navigation';

  let { chats, agents = [], currentPath = '/', collapsible = 'offcanvas' } = $props<{ chats: string[], agents?: any[], currentPath?: string, collapsible?: 'none' | 'icon' | 'offcanvas' }>();

  let newChatOpen = $state(false);
  let newChatName = $state('');
  let selectedAgent = $state('');
  let isCreating = $state(false);
  let errorMessage = $state('');

  let showValidationError = $derived(newChatName.length > 0 && /\s/.test(newChatName));
  let isValidName = $derived(newChatName.trim().length > 0 && !/\s/.test(newChatName));

  async function createNewChat() {
    if (!isValidName) return;
    
    const validName = newChatName.trim();
    isCreating = true;
    errorMessage = '';

    try {
      const payload: any = { id: validName };
      if (selectedAgent) {
        payload.agent = selectedAgent;
      }
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        newChatOpen = false;
        newChatName = '';
        selectedAgent = '';
        errorMessage = '';
        await invalidate('app:chats');
        await goto(`/chats/${validName}`);
      } else {
        const data = await res.json();
        errorMessage = data.error || 'Failed to create chat.';
      }
    } catch (err) {
      console.error(err);
      errorMessage = 'An error occurred while creating the chat.';
    } finally {
      isCreating = false;
    }
  }
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
      <Sidebar.GroupLabel>General</Sidebar.GroupLabel>
      <Sidebar.GroupContent>
        <Sidebar.Menu>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton isActive={currentPath === '/agents'}>
              {#snippet child({ props })}
                <a href="/agents" {...props}>
                  <Bot />
                  <span>Agents</span>
                </a>
              {/snippet}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.GroupContent>
    </Sidebar.Group>

    <Sidebar.Group>
      <Sidebar.GroupLabel>Chats</Sidebar.GroupLabel>
      <Sidebar.GroupContent>
        <Sidebar.Menu>
          <Sidebar.MenuItem>
            <Dialog.Root bind:open={newChatOpen}>
              <Dialog.Trigger>
                {#snippet child({ props })}
                  <Sidebar.MenuButton {...props}>
                    <Plus />
                    <span>New Chat</span>
                  </Sidebar.MenuButton>
                {/snippet}
              </Dialog.Trigger>
              <Dialog.Content class="sm:max-w-[425px]">
                <Dialog.Header>
                  <Dialog.Title>Create New Chat</Dialog.Title>
                  <Dialog.Description>
                    Enter a name for the new chat and optionally select an agent.
                  </Dialog.Description>
                </Dialog.Header>
                <div class="grid gap-4 py-4">
                  {#if errorMessage}
                    <div class="bg-destructive/15 text-destructive text-sm p-3 rounded-md flex items-center">
                      {errorMessage}
                    </div>
                  {/if}
                  <div class="flex flex-col gap-2">
                    <label class="text-sm font-medium leading-none" for="name">Name</label>
                    <Input
                      id="name"
                      bind:value={newChatName}
                      placeholder="e.g. debugging-session"
                      class="col-span-3"
                      autocomplete="off"
                      autocorrect="off"
                      autocapitalize="off"
                      spellcheck="false"
                      onkeydown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          createNewChat();
                        }
                      }}
                    />
                    {#if showValidationError}
                      <p class="text-sm text-destructive">Name cannot contain spaces.</p>
                    {/if}
                  </div>
                  <div class="flex flex-col gap-2">
                    <label class="text-sm font-medium leading-none" for="agent">Initial Agent (optional)</label>
                    <select
                      id="agent"
                      bind:value={selectedAgent}
                      class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">Default</option>
                      {#each agents as agent (agent.id)}
                        <option value={agent.id}>{agent.id}</option>
                      {/each}
                    </select>
                  </div>
                </div>
                <Dialog.Footer>
                  <Button type="submit" disabled={!isValidName || isCreating} onclick={createNewChat}>
                    {isCreating ? 'Creating...' : 'Create Chat'}
                  </Button>
                </Dialog.Footer>
              </Dialog.Content>
            </Dialog.Root>
          </Sidebar.MenuItem>
          {#each chats as chat (chat)}
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
