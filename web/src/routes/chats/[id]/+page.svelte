<script lang="ts">
  import type { PageData } from './$types';
  import type { ChatMessage } from '$lib/types';
  import { invalidate } from '$app/navigation';
  import { Send, Clock, AlertCircle } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { tick, onMount, onDestroy } from 'svelte';
  import { appState } from '$lib/app-state.svelte.js';

  let { data } = $props<{ data: PageData }>();

  type PendingStatus = 'sending' | 'pending' | 'failed';
  interface PendingMessage {
    id: string;
    content: string;
    timestamp: string;
    status: PendingStatus;
  }

  let inputValue = $state('');
  let liveMessages = $state<ChatMessage[]>([]);
  let filteredMessages = $derived(liveMessages.filter((msg) => {
    if (msg.role === 'user') return true;
    if (appState.verbosityLevel === 'verbose') return true;
    if (appState.verbosityLevel === 'debug') {
      return !msg.level || msg.level === 'default' || msg.level === 'debug';
    }
    return !msg.level || msg.level === 'default';
  }));
  let pendingMessages = $state<PendingMessage[]>([]);
  let chatContainer: HTMLElement | undefined = $state();
  let eventSource: EventSource | null = null;
  let isScrolledToBottom = $state(true);
  let isReconnecting = $state(false);
  let reconnectTimeout: ReturnType<typeof setTimeout>;
  let activeActionId = $state<string | null>(null);

  async function retryMessage(msgId: string) {
    const msgIndex = pendingMessages.findIndex(m => m.id === msgId);
    if (msgIndex === -1) return;
    
    pendingMessages[msgIndex].status = 'sending';
    savePendingMessages(data.id, pendingMessages);

    try {
      const res = await fetch(`/api/chats/${data.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: pendingMessages[msgIndex].content })
      });
      if (!res.ok) throw new Error('Failed to send');
      
      await invalidate(`app:chat:${data.id}`);
    } catch (err) {
      console.error('Failed to retry message:', err);
      const idx = pendingMessages.findIndex(m => m.id === msgId);
      if (idx !== -1) {
        pendingMessages[idx].status = 'failed';
        savePendingMessages(data.id, pendingMessages);
      }
    }
  }

  function deleteMessage(msgId: string) {
    pendingMessages = pendingMessages.filter(m => m.id !== msgId);
    savePendingMessages(data.id, pendingMessages);
  }

  $effect(() => {
    const handleOnline = () => {
      pendingMessages.forEach((msg) => {
        if (msg.status === 'pending' || msg.status === 'failed') {
          retryMessage(msg.id);
        }
      });
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  });

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
    
    // Load pending from local storage
    try {
      const stored = localStorage.getItem(`pending_messages_${data.id}`);
      if (stored) {
        pendingMessages = JSON.parse(stored);
      } else {
        pendingMessages = [];
      }
    } catch {
      pendingMessages = [];
    }
    
    isScrolledToBottom = true;
    setupSSE(data.id);
  });

  function savePendingMessages(chatId: string, messages: PendingMessage[]) {
    localStorage.setItem(`pending_messages_${chatId}`, JSON.stringify(messages));
  }

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

  async function fetchDeltaMessages() {
    const lastMsgId = liveMessages.length > 0 ? liveMessages[liveMessages.length - 1].id : null;
    if (lastMsgId) {
      try {
        const res = await fetch(`/api/chats/${data.id}?since=${lastMsgId}`);
        if (res.ok) {
          const newMessages: ChatMessage[] = await res.json();
          for (const msg of newMessages) {
            if (!liveMessages.find((m) => m.id === msg.id)) {
              liveMessages = [...liveMessages, msg];
            }
          }
        }
      } catch (e) {
        console.error('Failed to fetch delta messages:', e);
      }
    } else {
      await invalidate(`app:chat:${data.id}`);
    }
  }

  $effect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchDeltaMessages();
        if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
          setupSSE(data.id);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });

  function setupSSE(chatId: string) {
    if (eventSource) {
      eventSource.close();
      clearTimeout(reconnectTimeout);
    }
    
    eventSource = new EventSource(`/api/chats/${chatId}/stream`);
    
    eventSource.onopen = () => {
      isReconnecting = false;
    };

    eventSource.onerror = () => {
      if (eventSource?.readyState === EventSource.CLOSED || eventSource?.readyState === EventSource.CONNECTING) {
        isReconnecting = true;
        eventSource.close();
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(async () => {
          await fetchDeltaMessages();
          setupSSE(chatId);
        }, 3000);
      }
    };

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
               savePendingMessages(chatId, pendingMessages);
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
    clearTimeout(reconnectTimeout);
  });

  async function sendMessage(e: Event) {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const currentInput = inputValue;
    inputValue = '';
    
    const pendingMsg: PendingMessage = {
      id: `pending-${Date.now()}-${Math.random()}`,
      content: currentInput,
      timestamp: new Date().toISOString(),
      status: navigator.onLine ? 'sending' : 'pending'
    };
    pendingMessages = [...pendingMessages, pendingMsg];
    savePendingMessages(data.id, pendingMessages);

    if (!navigator.onLine) {
      return; // Offline, stays pending
    }

    try {
      const res = await fetch(`/api/chats/${data.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: currentInput })
      });
      if (!res.ok) throw new Error('Failed to send');
      
      // SSE should handle the incoming log and user messages now.
      // But we can still invalidate to be safe.
      await invalidate(`app:chat:${data.id}`);
    } catch (err) {
      console.error('Failed to send message:', err);
      // Mark as failed instead of removing
      pendingMessages = pendingMessages.map((m) => m.id === pendingMsg.id ? { ...m, status: 'failed' } : m);
      savePendingMessages(data.id, pendingMessages);
    }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="flex flex-col flex-1 h-full overflow-hidden relative">
  {#if isReconnecting}
    <div class="absolute top-4 left-1/2 -translate-x-1/2 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 text-xs px-3 py-1 rounded-full border border-yellow-500/20 backdrop-blur-sm shadow-sm z-10 flex items-center gap-2">
      <span class="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin"></span>
      Reconnecting...
    </div>
  {/if}

  <div bind:this={chatContainer} onscroll={checkScroll} class="flex-1 overflow-y-auto p-4">
    <div class="w-full max-w-4xl mx-auto space-y-6 flex flex-col min-h-full">
      {#if liveMessages.length === 0}
        <div class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          No messages yet. Send a message to start the conversation!
        </div>
      {/if}

    {#each filteredMessages as msg (msg.id)}
      <div class="flex flex-col gap-1 {msg.role === 'user' ? 'items-end' : 'items-start'}">
        <div class="flex items-baseline gap-2 max-w-[80%] {msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}">
          {#if msg.role === 'user'}
            <div class="px-4 py-2 rounded-2xl bg-primary text-primary-foreground text-sm" data-testid="user-message">
              {msg.content}
            </div>
          {:else}
            <div class="px-4 py-3 rounded-2xl bg-card border text-card-foreground text-sm shadow-sm {msg.level === 'verbose' ? 'border-primary/50 bg-primary/5 shadow-md' : ''}" data-testid="log-message">
              {#if appState.verbosityLevel === 'verbose'}
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
      <div class="flex flex-col gap-1 items-end {msg.status === 'sending' ? 'opacity-50' : ''} transition-opacity">
        <button
          class="flex items-baseline gap-2 max-w-[80%] flex-row-reverse text-left focus:outline-none"
          onclick={() => {
            if (msg.status !== 'sending') {
              activeActionId = activeActionId === msg.id ? null : msg.id;
            }
          }}
        >
          <div class="px-4 py-2 rounded-2xl {msg.status === 'failed' ? 'bg-destructive/90 text-destructive-foreground' : 'bg-primary text-primary-foreground'} text-sm" data-testid="pending-message">
            {msg.content}
          </div>
        </button>
        <div class="text-[10px] px-2 flex items-center gap-1 {msg.status === 'failed' ? 'text-destructive font-medium' : 'text-muted-foreground'}">
          {#if msg.status === 'sending'}
            <span class="inline-block w-2 h-2 rounded-full border border-current border-t-transparent animate-spin"></span>
            Sending...
          {:else if msg.status === 'pending'}
            <Clock class="w-3 h-3" />
            Offline / Pending
          {:else if msg.status === 'failed'}
            <AlertCircle class="w-3 h-3" />
            Failed
          {/if}
        </div>
        {#if activeActionId === msg.id && msg.status !== 'sending'}
          <div class="flex items-center gap-2 mt-1 mr-2 bg-card border rounded-md p-1 shadow-sm text-xs">
            <button class="px-2 py-1 hover:bg-muted rounded text-primary transition-colors focus:outline-none" onclick={(e) => { e.stopPropagation(); activeActionId = null; retryMessage(msg.id); }}>Retry manual send</button>
            <div class="w-px h-3 bg-border"></div>
            <button class="px-2 py-1 hover:bg-muted rounded text-destructive transition-colors focus:outline-none" onclick={(e) => { e.stopPropagation(); activeActionId = null; deleteMessage(msg.id); }}>Delete message</button>
          </div>
        {/if}
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
