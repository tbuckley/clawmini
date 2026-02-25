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
  let isSending = $state(false);
  let liveMessages = $state<ChatMessage[]>([]);
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
    isScrolledToBottom = true;
    setupSSE(data.id);
  });

  // Auto-scroll on new messages
  $effect(() => {
    if (liveMessages.length > 0 && chatContainer && isScrolledToBottom) {
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
    if (!inputValue.trim() || isSending) return;

    isSending = true;
    const currentInput = inputValue;
    inputValue = '';

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
      // Restore input on failure
      inputValue = currentInput;
    } finally {
      isSending = false;
    }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="flex flex-col flex-1 h-full overflow-hidden">
  <div bind:this={chatContainer} onscroll={checkScroll} class="flex-1 overflow-y-auto p-4 space-y-6">
    {#if liveMessages.length === 0}
      <div class="h-full flex items-center justify-center text-muted-foreground text-sm">
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
  </div>

  <div class="p-4 bg-background/80 backdrop-blur-sm border-t shrink-0">
    <form onsubmit={sendMessage} class="flex items-center gap-2 max-w-4xl mx-auto">
      <Textarea
        bind:value={inputValue}
        placeholder="Type your message..."
        class="flex-1 min-h-[0px] resize-none overflow-hidden h-auto"
        disabled={isSending}
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(e);
          }
        }}
        data-testid="message-input"
      />
      <Button type="submit" disabled={isSending || !inputValue.trim()} size="icon" data-testid="send-button">
        <Send class="w-4 h-4" />
        <span class="sr-only">Send</span>
      </Button>
    </form>
  </div>
</div>
