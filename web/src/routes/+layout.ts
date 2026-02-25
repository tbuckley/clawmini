import { browser } from '$app/environment';
import type { LayoutLoad } from './$types';

export const ssr = false;

export const load: LayoutLoad = async ({ fetch, depends }) => {
  // The CLI runs the web server on the same origin (127.0.0.1:8080 or configurable)
  // or proxies it if we're in dev mode. Let's use relative fetch so it works everywhere.
  depends('app:chats');
  try {
    const res = await fetch('/api/chats');
    if (res.ok) {
      const chats = await res.json();
      return { chats };
    }
  } catch (e) {
    console.error(e);
  }
  return { chats: [] };
};
