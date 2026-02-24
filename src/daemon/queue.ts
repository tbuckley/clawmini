import { spawn } from 'node:child_process';
import { appendMessage, type UserMessage, type CommandLogMessage } from '../shared/chats.js';

type Task = () => Promise<void>;

class DirectoryQueue {
  private queue: Promise<void> = Promise.resolve();

  enqueue(task: Task): Promise<void> {
    const next = this.queue.then(task).catch(() => {});
    this.queue = next;
    return next;
  }
}

const queues = new Map<string, DirectoryQueue>();

export function getQueue(dir: string): DirectoryQueue {
  if (!queues.has(dir)) {
    queues.set(dir, new DirectoryQueue());
  }
  return queues.get(dir)!;
}

export async function handleUserMessage(chatId: string, message: string, settings: { chats?: { new?: string; [key: string]: unknown }; [key: string]: unknown } | undefined, cwd: string = process.cwd(), noWait: boolean = false): Promise<void> {
  const userMsg: UserMessage = {
    role: 'user',
    content: message,
    timestamp: new Date().toISOString()
  };
  await appendMessage(chatId, userMsg);

  if (!settings?.chats?.new) {
    throw new Error('No chats.new defined in settings.json');
  }

  const cmd = settings.chats.new;
  const queue = getQueue(cwd);

  const taskPromise = queue.enqueue(() => {
    return new Promise<void>((resolve) => {
      const p = spawn(cmd, {
        shell: true,
        cwd,
        env: {
          ...process.env,
          CLAW_CLI_MESSAGE: message,
        },
      });

      let stdout = '';
      let stderr = '';

      if (p.stdout) {
        p.stdout.on('data', (data) => {
          stdout += data.toString();
          process.stdout.write(data);
        });
      }

      if (p.stderr) {
        p.stderr.on('data', (data) => {
          stderr += data.toString();
          process.stderr.write(data);
        });
      }

      p.on('close', async (code) => {
        const logMsg: CommandLogMessage = {
          role: 'log',
          content: stdout,
          stderr: stderr,
          timestamp: new Date().toISOString(),
          command: cmd,
          cwd,
          exitCode: code ?? 1,
        };
        await appendMessage(chatId, logMsg);
        resolve();
      });

      p.on('error', async (err) => {
        const logMsg: CommandLogMessage = {
          role: 'log',
          content: '',
          stderr: err.toString(),
          timestamp: new Date().toISOString(),
          command: cmd,
          cwd,
          exitCode: 1,
        };
        await appendMessage(chatId, logMsg);
        resolve();
      });
    });
  });

  if (!noWait) {
    await taskPromise;
  }
}
