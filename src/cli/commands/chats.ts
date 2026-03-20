import { Command } from 'commander';
import {
  listChats,
  createChat,
  deleteChat,
  setDefaultChatId,
  getDefaultChatId,
  DEFAULT_CHAT_ID,
} from '../../shared/chats.js';
import { getDaemonClient } from '../client.js';

export const chatsCmd = new Command('chats').description('Manage chat sessions');

chatsCmd
  .command('list')
  .description('Display existing chats')
  .action(async () => {
    try {
      const chats = await listChats();
      const defaultId = await getDefaultChatId();
      if (chats.length === 0) {
        console.log('No chats found.');
        return;
      }
      for (const id of chats) {
        const marker = id === defaultId ? ' *' : '';
        console.log(`- ${id}${marker}`);
      }
    } catch (err) {
      console.error('Failed to list chats:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

chatsCmd
  .command('add <id>')
  .description('Initialize a new chat')
  .action(async (id: string) => {
    try {
      await createChat(id);
      console.log(`Chat ${id} created successfully.`);
    } catch (err) {
      console.error('Failed to create chat:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

chatsCmd
  .command('delete <id>')
  .description('Remove a chat')
  .action(async (id: string) => {
    try {
      const defaultId = await getDefaultChatId();

      try {
        const trpc = await getDaemonClient({ autoStart: false });
        await trpc.deleteChat.mutate({ chatId: id });
      } catch {
        // Fallback to local deletion if daemon isn't running
        await deleteChat(id);
      }

      console.log(`Chat ${id} deleted successfully.`);
      if (id === defaultId) {
        await setDefaultChatId(DEFAULT_CHAT_ID);
        console.log(`Default chat reset to default.`);
      }
    } catch (err) {
      console.error('Failed to delete chat:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

chatsCmd
  .command('set-default <id>')
  .description('Update the workspace default chat')
  .action(async (id: string) => {
    try {
      await setDefaultChatId(id);
      console.log(`Default chat set to ${id}.`);
    } catch (err) {
      console.error(
        'Failed to set default chat:',
        err instanceof Error ? err.message : String(err)
      );
      process.exit(1);
    }
  });
