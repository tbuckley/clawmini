import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Wrapper from './app-sidebar-test-wrapper.svelte';

describe('app-sidebar.svelte', () => {
  it('should render chat list', async () => {
    render(Wrapper, { props: { chats: ['chat1', 'chat2'] } });

    await expect.element(page.getByText('chat1')).toBeInTheDocument();
    await expect.element(page.getByText('chat2')).toBeInTheDocument();
  });
});
