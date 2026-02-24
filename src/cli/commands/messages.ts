import { Command } from 'commander';
import { getDaemonClient } from '../client.js';

export const messagesCmd = new Command('messages').description('Manage messages');

messagesCmd
  .command('send <message>')
  .description('Send a new message')
  .action(async (message) => {
    try {
      const trpc = await getDaemonClient();
      await trpc.sendMessage.mutate({
        type: 'send-message',
        client: 'cli',
        data: { message },
      });
      console.log('Message sent successfully.');
    } catch (err) {
      console.error('Failed to send message:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
