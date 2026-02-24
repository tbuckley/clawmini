import { Command } from 'commander';
import { getDaemonClient } from '../client.js';
import { getMessages, getDefaultChatId } from '../../shared/chats.js';

export const messagesCmd = new Command('messages').description('Manage messages');

messagesCmd
  .command('send <message>')
  .description('Send a new message')
  .option('-c, --chat <id>', 'Specific chat to send the message to')
  .action(async (message, options) => {
    try {
      const trpc = await getDaemonClient();
      await trpc.sendMessage.mutate({
        type: 'send-message',
        client: 'cli',
        data: { 
          message,
          chatId: options.chat,
        },
      });
      console.log('Message sent successfully.');
    } catch (err) {
      console.error('Failed to send message:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('tail')
  .description('View message history')
  .option('-n, --lines <number>', 'Number of messages to show', parseInt)
  .option('--json', 'Output raw JSONL format')
  .option('-c, --chat <id>', 'Specific chat to view')
  .action(async (options) => {
    try {
      const chatId = options.chat ?? await getDefaultChatId();
      const messages = await getMessages(chatId, options.lines);

      if (options.json) {
        messages.forEach(msg => console.log(JSON.stringify(msg)));
      } else {
        messages.forEach(msg => {
          if (msg.role === 'user') {
            console.log(`[USER] ${msg.timestamp}: ${msg.content}`);
          } else if (msg.role === 'log') {
            console.log(`[LOG] ${msg.timestamp} [${msg.command}] (Exit: ${msg.exitCode}):`);
            if (msg.content) console.log(msg.content.trim());
            if (msg.stderr) console.error(`[STDERR] ${msg.stderr.trim()}`);
          }
        });
      }
    } catch (err) {
      console.error('Failed to retrieve messages:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
