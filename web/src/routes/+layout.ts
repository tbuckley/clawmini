import type { LayoutLoad } from './$types';

export const ssr = false;

export const load: LayoutLoad = async ({ fetch, depends }) => {
  // The CLI runs the web server on the same origin (127.0.0.1:8080 or configurable)
  // or proxies it if we're in dev mode. Let's use relative fetch so it works everywhere.
  depends('app:chats');
  depends('app:agents');

  let chats: string[] = [];
  let agents: { id: string; directory?: string; env?: Record<string, string> }[] = [];

  try {
    const resChats = await fetch('/api/chats');
    if (resChats.ok) {
      chats = await resChats.json();
    }
  } catch (e) {
    console.error('Failed to load chats:', e);
  }

  try {
    const resAgents = await fetch('/api/agents');
    if (resAgents.ok) {
      agents = await resAgents.json();
    }
  } catch (e) {
    console.error('Failed to load agents:', e);
  }

  return { chats, agents };
};
