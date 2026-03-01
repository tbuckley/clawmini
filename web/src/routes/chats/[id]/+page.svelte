<script lang="ts">
  import type { PageData } from './$types';
  import type { ChatMessage } from '$lib/types';
  import { invalidate } from '$app/navigation';
  import { Send } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { tick, onMount, onDestroy } from 'svelte';
  import { appState } from '$lib/app-state.svelte.js';

  let { data } = $props<{ data: PageData }>();

  let inputValue = $state('');
  let liveMessages = $state<ChatMessage[]>([]);
  let pendingMessages = $state<{ id: string; content: string; timestamp: string }[]>([]);
  let chatContainer: HTMLElement | undefined = $state();
  let eventSource: EventSource | null = null;
  let isScrolledToBottom = $state(true);

  function checkScroll(e: Event) {
    const target = e.target as HTMLElement;
    // Allow a 10px threshold for being at the bottom
    isScrolledToBottom = Math.abs(target.scrollHeight - target.scrollTop - target.clientHeight) < 10;
  }

  function scrollToBottom() {
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  // We sync live messages with initial loaded data whenever the ID changes
  $effect(() => {
    liveMessages = data.messages as ChatMessage[];
    pendingMessages = []; // Clear pending on chat switch
    isScrolledToBottom = true;
    setupSSE(data.id);
  });

  // Auto-scroll on new messages
  $effect(() => {
    if ((liveMessages.length > 0 || pendingMessages.length > 0) && chatContainer && isScrolledToBottom) {
      tick().then(scrollToBottom);
    }
  });

  // Keep scrolled to bottom if textarea grows
  $effect(() => {
    // depend on inputValue changes
    inputValue;
    if (isScrolledToBottom) {
      tick().then(scrollToBottom);
    }
  });

  // Keep scrolled to bottom on window or visualViewport resize (e.g., keyboard toggle)
  $effect(() => {
    const handleResize = () => {
      if (isScrolledToBottom) {
        scrollToBottom();
      }
    };
    
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  });

  function setupSSE(chatId: string) {
    if (eventSource) {
      eventSource.close();
    }
    eventSource = new EventSource(`/api/chats/${chatId}/stream`);
    eventSource.onmessage = (event) => {
      try {
        const newMessage = JSON.parse(event.data);
        // Ensure we don't duplicate messages we just sent and received via SSE
        if (!liveMessages.find((m) => m.id === newMessage.id)) {
          liveMessages = [...liveMessages, newMessage];
          
          if (newMessage.role === 'user') {
            // Remove from pending by matching content
            const idx = pendingMessages.findIndex(m => m.content === newMessage.content);
            if (idx !== -1) {
               pendingMessages = pendingMessages.filter((_, i) => i !== idx);
            }
          }
        }
      } catch (e) {
        console.error('Failed to parse SSE message', e);
      }
    };
  }

  onDestroy(() => {
    if (eventSource) {
      eventSource.close();
    }
  });

  async function sendMessage(e: Event) {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const currentInput = inputValue;
    inputValue = '';
    
    const pendingMsg = {
      id: `pending-${Date.now()}-${Math.random()}`,
      content: currentInput,
      timestamp: new Date().toISOString()
    };
    pendingMessages = [...pendingMessages, pendingMsg];

    try {
      await fetch(`/api/chats/${data.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: currentInput })
      });
      // SSE should handle the incoming log and user messages now.
      // But we can still invalidate to be safe.
      await invalidate(`app:chat:${data.id}`);
    } catch (err) {
      console.error('Failed to send message:', err);
      // Remove the specific pending message on failure
      pendingMessages = pendingMessages.filter((m) => m.id !== pendingMsg.id);
      // Restore input on failure
      inputValue = currentInput;
    }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="flex flex-col flex-1 h-full overflow-hidden">
  <div bind:this={chatContainer} onscroll={checkScroll} class="flex-1 overflow-y-auto p-4">
    <div class="w-full max-w-4xl mx-auto space-y-6 flex flex-col min-h-full">
      {#if liveMessages.length === 0}
        <div class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          No messages yet. Send a message to start the conversation!
        </div>
      {/if}

    {#each liveMessages as msg (msg.id)}
      <div class="flex flex-col gap-1 {msg.role === 'user' ? 'items-end' : 'items-start'}">
        <div class="flex items-baseline gap-2 max-w-[80%] {msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}">
          {#if msg.role === 'user'}
            <div class="px-4 py-2 rounded-2xl bg-primary text-primary-foreground text-sm" data-testid="user-message">
              {msg.content}
            </div>
          {:else}
            <div class="px-4 py-3 rounded-2xl bg-card border text-card-foreground text-sm shadow-sm" data-testid="log-message">
              {#if appState.debugView}
                <div class="font-mono text-xs text-muted-foreground mb-2 flex items-center gap-2">
                  <span>$ {msg.command}</span>
                  {#if msg.exitCode !== 0}
                    <span class="text-destructive font-bold">Exit: {msg.exitCode}</span>
                  {/if}
                </div>
                
                {#if msg.content}
                  <div class="whitespace-pre-wrap">{msg.content}</div>
                {:else if msg.stdout}
                  <div class="whitespace-pre-wrap font-mono text-xs mt-2">{msg.stdout}</div>
                {:else}
                  <div class="whitespace-pre-wrap italic opacity-50 text-xs mt-2">No output</div>
                {/if}

                {#if msg.stderr}
                  <div class="whitespace-pre-wrap font-mono text-xs mt-2 text-destructive border border-destructive/20 bg-destructive/5 p-2 rounded">
                    {msg.stderr}
                  </div>
                {/if}
              {:else}
                {#if msg.content}
                  <div class="whitespace-pre-wrap">{msg.content}</div>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
        <div class="text-[10px] text-muted-foreground px-2">
          {formatTime(msg.timestamp)}
        </div>
      </div>
    {/each}

    {#each pendingMessages as msg (msg.id)}
      <div class="flex flex-col gap-1 items-end opacity-50 transition-opacity">
        <div class="flex items-baseline gap-2 max-w-[80%] flex-row-reverse">
          <div class="px-4 py-2 rounded-2xl bg-primary text-primary-foreground text-sm" data-testid="pending-message">
            {msg.content}
          </div>
        </div>
        <div class="text-[10px] text-muted-foreground px-2 flex items-center gap-1">
          <span class="inline-block w-2 h-2 rounded-full border border-current border-t-transparent animate-spin"></span>
          Sending...
        </div>
      </div>
    {/each}
    </div>
  </div>

  <div class="p-4 bg-background/80 backdrop-blur-sm border-t shrink-0">
    <form onsubmit={sendMessage} class="flex items-center gap-2 max-w-4xl mx-auto">
      <Textarea
        bind:value={inputValue}
        placeholder="Type your message..."
        class="flex-1 min-h-[0px] resize-none overflow-hidden h-auto"
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(e);
          }
        }}
        data-testid="message-input"
      />
      <Button type="submit" disabled={!inputValue.trim()} size="icon" data-testid="send-button">
        <Send class="w-4 h-4" />
        <span class="sr-only">Send</span>
      </Button>
    </form>
  </div>
</div>
