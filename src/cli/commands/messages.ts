import { Command } from 'commander';
import { getDaemonClient } from '../client.js';
import { getMessages, getDefaultChatId } from '../../shared/chats.js';
import { getAgent, isValidAgentId, getClawminiDir, readSettings } from '../../shared/workspace.js';
import * as fs from 'node:fs/promises';
import path from 'node:path';

export const messagesCmd = new Command('messages').description('Manage messages');

messagesCmd
  .command('send <message>')
  .description('Send a new message')
  .option('-c, --chat <id>', 'Specific chat to send the message to')
  .option('-s, --session <id>', 'Specific session to send the message to')
  .option('-a, --agent <name>', 'Specific agent to use for this message')
  .option('--no-wait', 'Return immediately after the server queues the message')
  .option('-f, --file <path>', 'File to attach', (val, prev: string[]) => prev.concat([val]), [])
  .action(async (message, options) => {
    try {
      if (options.agent) {
        if (!isValidAgentId(options.agent)) {
          console.error(`Error: Invalid agent ID '${options.agent}'.`);
          process.exit(1);
        }

        if (options.agent !== 'default') {
          const agent = await getAgent(options.agent);
          if (!agent) {
            console.error(`Error: Agent '${options.agent}' not found.`);
            process.exit(1);
          }
        }
      }

      let finalFiles: string[] | undefined = undefined;
      if (options.file && options.file.length > 0) {
        finalFiles = [];
        const tmpDir = path.join(getClawminiDir(process.cwd()), 'tmp');
        await fs.mkdir(tmpDir, { recursive: true });
        for (const f of options.file) {
          const dest = path.join(
            tmpDir,
            `cli-${Date.now()}-${Math.random().toString(36).substring(2, 7)}-${path.basename(f)}`
          );
          await fs.copyFile(path.resolve(process.cwd(), f), dest);
          finalFiles.push(dest);
        }
      }

      const trpc = await getDaemonClient();
      await trpc.sendMessage.mutate({
        type: 'send-message',
        client: 'cli',
        data: {
          message,
          chatId: options.chat,
          sessionId: options.session,
          agentId: options.agent,
          noWait: !options.wait,
          files: finalFiles,
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
      const chatId = options.chat ?? (await getDefaultChatId());
      let messages = await getMessages(chatId, options.lines, undefined, (msg) => !msg.subagentId);

      const settings = await readSettings(process.cwd());

      if (settings?.timestampPrefix !== false) {
        messages = messages.map((msg) => {
          if (msg.role === 'user' || msg.displayRole === 'user') {
            const date = new Date(msg.timestamp);
            const pad = (n: number) => String(n).padStart(2, '0');
            const YYYY = date.getFullYear();
            const MM = pad(date.getMonth() + 1);
            const DD = pad(date.getDate());
            const HH = pad(date.getHours());
            const MIN = pad(date.getMinutes());

            // Try to get timezone abbreviation (e.g. EST, PDT) or fallback to offset
            let z = '';
            try {
              const parts = new Intl.DateTimeFormat('en-US', {
                timeZoneName: 'short',
              }).formatToParts(date);
              const tzPart = parts.find((p) => p.type === 'timeZoneName');
              if (tzPart) z = tzPart.value;
            } catch {
              // Ignore
            }

            if (!z) {
              const offset = -date.getTimezoneOffset();
              const sign = offset >= 0 ? '+' : '-';
              z = `GMT${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
            }

            const prefix = `[${YYYY}-${MM}-${DD} ${HH}:${MIN} ${z}] `;
            return {
              ...msg,
              content: `${prefix}${msg.content}`,
            };
          }
          return msg;
        });
      }

      if (options.json) {
        messages.forEach((msg) => console.log(JSON.stringify(msg)));
      } else {
        messages.forEach((msg) => {
          if (msg.role === 'user' || msg.displayRole === 'user') {
            console.log(`[USER] ${msg.content}`);
          } else if (msg.role === 'agent' || msg.displayRole === 'agent') {
            console.log(`[AGENT] ${msg.content.trim()}`);
          } else if (msg.role === 'policy') {
            console.log(`[POLICY] ${msg.commandName} ${msg.args.join(' ')}`);
          } else if (msg.role === 'tool') {
            console.log(`[TOOL] ${msg.name}`);
          } else if (msg.role === 'system') {
            if (msg.content) {
              console.log(`[LOG] ${msg.content.trim()}`);
            }
          } else if (msg.role === 'command' || msg.role === 'legacy_log') {
            if (msg.content) {
              console.log(`[LOG] ${msg.content.trim()}`);
            } else if (msg.stderr) {
              console.error(`[STDERR] ${msg.stderr.trim()}`);
            }
          }
        });
      }
    } catch (err) {
      console.error(
        'Failed to retrieve messages:',
        err instanceof Error ? err.message : String(err)
      );
      process.exit(1);
    }
  });
