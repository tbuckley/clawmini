export let activeSpaceName: string | null = null;
export let activeThreadName: string | null = null;

export function setActiveThread(space: string, thread: string) {
  activeSpaceName = space;
  activeThreadName = thread;
}
