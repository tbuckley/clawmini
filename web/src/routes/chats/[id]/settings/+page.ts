import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch, depends }) => {
  const { id } = params;
  depends(`app:chat:${id}:cron`);

  let cronJobs = [];
  try {
    const res = await fetch(`/api/chats/${id}/cron`);
    if (res.ok) {
      cronJobs = await res.json();
    }
  } catch (e) {
    console.error('Failed to load cron jobs:', e);
  }

  return { id, cronJobs };
};
