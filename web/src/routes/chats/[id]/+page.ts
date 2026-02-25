import type { PageLoad } from './$types';
import type { ChatMessage } from '$lib/types';

export const load: PageLoad = async ({ params, fetch, depends }) => {
  const { id } = params;
  depends(`app:chat:${id}`);

  try {
    const res = await fetch(`/api/chats/${id}`);
    if (res.ok) {
      const messages: ChatMessage[] = await res.json();
      return { id, messages };
    }
  } catch (e) {
    console.error(e);
  }

  return { id, messages: [] };
};
