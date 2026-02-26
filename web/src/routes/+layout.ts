import type { LayoutLoad } from './$types';

export const ssr = false;

export const load: LayoutLoad = async ({ fetch, depends }) => {
  // The CLI runs the web server on the same origin (127.0.0.1:8080 or configurable)
  // or proxies it if we're in dev mode. Let's use relative fetch so it works everywhere.
  depends('app:chats');
  depends('app:agents');

  let chats: string[] = [];
  let agents: { id: string; directory?: string; env?: Record<string, string> }[] = [];

  const [resChats, resAgents] = await Promise.all([
    fetch('/api/chats').catch((e) => {
      console.error('Failed to load chats:', e);
      return null;
    }),
    fetch('/api/agents').catch((e) => {
      console.error('Failed to load agents:', e);
      return null;
    }),
  ]);

  if (resChats?.ok) {
    chats = await resChats.json();
  }

  if (resAgents?.ok) {
    agents = await resAgents.json();
  }

  return { chats, agents };
};
